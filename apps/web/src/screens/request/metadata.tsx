import {
  Field,
  FieldGroup,
  FieldNone,
  Fields,
} from "@cota/ui/components/fields";
import type { ReactNode } from "react";
import { useNameOf } from "#shared/names.tsx";
import { counted, millis, plural } from "#shared/words.ts";
import type { RequestRecord } from "./queries.ts";
import { toTheSecond } from "./words.ts";

const none = <FieldNone>none</FieldNone>;

const orNone = (value: string): ReactNode => (value === "" ? none : value);

function Named({
  value,
  name,
}: {
  readonly value: string;
  readonly name: string;
}) {
  if (value === "") return none;
  return name === value ? (
    value
  ) : (
    <>
      {value} <FieldNone>({name})</FieldNone>
    </>
  );
}

function Headers({
  title,
  headers,
  empty,
}: {
  readonly title: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly empty: string;
}) {
  const entries = Object.entries(headers).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return (
    <FieldGroup level={2} title={title}>
      {entries.length === 0 ? (
        <Field name={empty}>{null}</Field>
      ) : (
        entries.map(([name, value]) => (
          <Field key={name} name={name}>
            {value}
          </Field>
        ))
      )}
    </FieldGroup>
  );
}

const bytes = (n: number) => plural(n, "byte");

export function MetadataPanel({
  request,
}: {
  readonly request: RequestRecord;
}) {
  const nameOf = useNameOf();
  return (
    <Fields>
      <FieldGroup level={2} title="Where it went">
        <Field name="Pool">
          <Named value={request.pool} name={nameOf("pool", request.pool)} />
        </Field>
        <Field name="Diverted from">
          {request.divertedFrom === null ? (
            <FieldNone>not diverted</FieldNone>
          ) : (
            <Named
              value={request.divertedFrom}
              name={nameOf("pool", request.divertedFrom)}
            />
          )}
        </Field>
        <Field name="Provider">{orNone(request.provider)}</Field>
        <Field name="Protocol">{request.protocol}</Field>
        <Field name="Operation">{request.operation}</Field>
        <Field name="Model asked for">{orNone(request.model)}</Field>
        <Field name="Model that answered">
          {request.servedModel === "" ? (
            <FieldNone>not reported, or the one asked for</FieldNone>
          ) : (
            request.servedModel
          )}
        </Field>
        <Field name="Service tier">{orNone(request.serviceTier)}</Field>
        <Field name="Streamed">{request.stream ? "yes" : "no"}</Field>
        <Field name="Stop reason">{orNone(request.stopReason)}</Field>
        <Field name="Provider's request id">
          {orNone(request.providerRequestId)}
        </Field>
        <Field name="Login fingerprint">
          {request.loginFingerprint === null ||
          request.loginFingerprint === "" ? (
            <FieldNone>none: a keyed pool, or no login sent</FieldNone>
          ) : (
            request.loginFingerprint
          )}
        </Field>
      </FieldGroup>
      <FieldGroup level={2} title="Who sent it">
        <Field name="Client">
          <Named
            value={request.client}
            name={nameOf("client", request.client)}
          />
        </Field>
        <Field name="Client version">{orNone(request.clientVersion)}</Field>
        <Field name="User agent">{orNone(request.userAgent)}</Field>
        <Field name="Hub key">{orNone(request.hubKey)}</Field>
        <Field name="Session">{request.session}</Field>
        <Field name="Session id read from">
          {request.sessionSource === "" ? (
            <FieldNone>nowhere: the hub made the key</FieldNone>
          ) : (
            request.sessionSource
          )}
        </Field>
      </FieldGroup>
      <FieldGroup level={2} title="Tags">
        <Field name="Machine">
          <Named
            value={request.machine}
            name={nameOf("machine", request.machine)}
          />
        </Field>
        <Field name="Project">
          <Named
            value={request.project}
            name={nameOf("project", request.project)}
          />
        </Field>
        <Field name="Client">
          <Named
            value={request.client}
            name={nameOf("client", request.client)}
          />
        </Field>
      </FieldGroup>
      <FieldGroup level={2} title="Timing and size">
        <Field name="Started">{toTheSecond(millis(request.startedAt))}</Field>
        <Field name="First byte after">
          {request.firstByteMs === null ? (
            <FieldNone>none came</FieldNone>
          ) : (
            `${counted(request.firstByteMs)} ms`
          )}
        </Field>
        <Field name="Duration">{counted(request.durationMs)} ms</Field>
        <Field name="Request body">{bytes(request.requestBytes)}</Field>
        <Field name="Response body">{bytes(request.responseBytes)}</Field>
        <Field name="Response read to the end">
          {request.readingComplete ? (
            "yes"
          ) : (
            <FieldNone>no: usage and output may be short</FieldNone>
          )}
        </Field>
      </FieldGroup>
      <Headers
        title="Quota headers"
        headers={request.rateLimits}
        empty="None came with the answer"
      />
      <Headers
        title="Client headers kept"
        headers={request.clientHeaders}
        empty="None on the protocol's list"
      />
    </Fields>
  );
}
