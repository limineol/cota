import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import {
  Field,
  FieldGroup,
  FieldNone,
  Fields,
} from "@cota/ui/components/fields";
import { JsonView } from "@cota/ui/components/json-view";
import { Subheading } from "@cota/ui/components/page";
import { CodeBlock } from "@cota/ui/components/prose";
import { ToolItem, ToolList } from "@cota/ui/components/tool-list";
import { span } from "#shared/domain/quantities.ts";
import { useNow } from "#shared/now.tsx";
import { millis } from "#shared/words.ts";
import { Written } from "#shared/written.tsx";
import type { Inspected, RequestRecord } from "./queries.ts";
import { toTheSecond } from "./words.ts";

export function ErrorPanel({ request }: { readonly request: RequestRecord }) {
  const now = useNow();
  const sameAsMessage =
    request.errorBody === "" || request.errorBody === request.errorMessage;
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <Fields>
        <FieldGroup level={2} title="What failed">
          <Field name="Error type">
            {request.errorType === "" ? (
              <FieldNone>none recorded</FieldNone>
            ) : (
              request.errorType
            )}
          </Field>
          <Field name="Upstream status">
            {request.upstreamStatus === 0 ? (
              <FieldNone>none: the provider never answered</FieldNone>
            ) : (
              request.upstreamStatus
            )}
          </Field>
          {request.refusalReset === null ? null : (
            <Field name="Login resets">
              {toTheSecond(millis(request.refusalReset))}{" "}
              <FieldNone>
                {millis(request.refusalReset) > now
                  ? `in ${span(millis(request.refusalReset) - now)}`
                  : "already passed"}
              </FieldNone>
            </Field>
          )}
          <Field name="Provider's request id">
            {request.providerRequestId === "" ? (
              <FieldNone>none</FieldNone>
            ) : (
              request.providerRequestId
            )}
          </Field>
        </FieldGroup>
      </Fields>
      <section
        aria-labelledby="error-message"
        className="flex flex-col gap-2.5"
      >
        <Subheading level={2} id="error-message">
          Message
        </Subheading>
        {request.errorMessage === "" ? (
          <CodeBlock quiet>No message was recorded.</CodeBlock>
        ) : (
          <Written text={request.errorMessage} />
        )}
      </section>
      {sameAsMessage ? null : (
        <section aria-labelledby="error-body" className="flex flex-col gap-2.5">
          <Subheading level={2} id="error-body">
            The body the provider answered with
          </Subheading>
          <Written text={request.errorBody} />
        </section>
      )}
    </div>
  );
}

export function ToolsPanel({ answer }: { readonly answer: Inspected }) {
  if (answer.tools === null || answer.tools.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No tools were offered.</EmptyTitle>
        <EmptyDescription>
          {answer.params === null
            ? "The request carried no conversation, so it offered the model nothing to call."
            : "The request gave the model no tool definitions. Tools a client sends inside its input show in Input."}
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <ToolList aria-label="Tools offered">
      {answer.tools.map((tool, index) => (
        <ToolItem
          // biome-ignore lint/suspicious/noArrayIndexKey: two tools may share a name, and their order is the request's
          key={index}
          name={tool.name ?? "a tool without a name"}
          description={tool.description}
        />
      ))}
    </ToolList>
  );
}

export function ParamsPanel({ answer }: { readonly answer: Inspected }) {
  if (answer.params === null) {
    return (
      <Empty>
        <EmptyTitle>There are no params.</EmptyTitle>
        <EmptyDescription>
          Params are a body's settings beside its conversation, and this request
          carried no conversation.
        </EmptyDescription>
      </Empty>
    );
  }
  return <JsonView value={answer.params} aria-label="Params" />;
}
