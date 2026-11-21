import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { page } from "#stories/page.tsx";
import {
  answeredAnswers,
  answeredRequest,
  cutAnswers,
  cutRequest,
  divertedAnswers,
  divertedRequest,
  failedAnswers,
  failedRead,
  failedRequest,
  importedAnswers,
  importedRequest,
  listingAnswers,
  listingRequest,
  loadingRequest,
  missingId,
  missingRequest,
  refusedAnswers,
  refusedRequest,
  unreportedAnswers,
  unreportedRequest,
} from "#stories/request.ts";

const meta = { title: "Screens/Request" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const pathOf = (id: string, tab?: string) =>
  tab === undefined ? `/requests/${id}` : `/requests/${id}?tab=${tab}`;

export const AnAnsweredRequest: Story = {
  ...page(pathOf(answeredRequest), answeredAnswers),
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "An answer from Claude Opus 4.5",
      }),
    ).toBeVisible();
    const output = canvas.getByRole("link", { name: "Output 3" });
    await expect(output).toHaveAttribute("aria-current", "page");
    await expect(output).toHaveAttribute(
      "href",
      `/requests/${answeredRequest}`,
    );
    const input = canvas.getByRole("link", { name: "Input 7" });
    await expect(input).toHaveAttribute(
      "href",
      `/requests/${answeredRequest}?tab=input`,
    );
    await userEvent.click(input);
    await waitFor(() => expect(input).toHaveAttribute("aria-current", "page"));
    await expect(
      canvas.getByText(/The checkout page shows the old total/),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Error" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /^The body as the hub forwarded it/ }),
    ).toBeVisible();
    await expect(
      canvas.queryByText(/Imported from a Bifrost log/),
    ).not.toBeInTheDocument();
  },
};

export const TheInputTab: Story = {
  ...page(pathOf(answeredRequest, "input"), answeredAnswers),
};

export const TheToolsTab: Story = {
  ...page(pathOf(answeredRequest, "tools"), answeredAnswers),
  play: async ({ canvas }) => {
    const tools = await canvas.findByRole("list", { name: "Tools offered" });
    await expect(tools).toBeVisible();
    await expect(canvas.getByText("mcp__docs__search")).toBeVisible();
  },
};

export const TheParamsTab: Story = {
  ...page(pathOf(answeredRequest, "params"), answeredAnswers),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('"budget_tokens"')).toBeVisible();
  },
};

export const TheMetadataTab: Story = {
  ...page(pathOf(answeredRequest, "metadata"), answeredAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("anthropic-ratelimit-unified-5h-utilization"),
    ).toBeVisible();
    await expect(canvas.getByText("Model asked for")).toBeVisible();
  },
};

export const TheTokenUsageTab: Story = {
  ...page(pathOf(answeredRequest, "usage"), answeredAnswers),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("94,310")).toBeVisible();
    await expect(canvas.getByText('"cache_read_input_tokens"')).toBeVisible();
  },
};

export const AFailedRequest: Story = {
  ...page(pathOf(failedRequest), failedAnswers),
  play: async ({ canvas }) => {
    const error = await canvas.findByRole("link", { name: "Error" });
    await expect(error).toHaveAttribute("aria-current", "page");
    await expect(error).toHaveAttribute("href", `/requests/${failedRequest}`);
    await expect(canvas.getByText("Error 529")).toBeVisible();
    await expect(
      canvas.getAllByText("overloaded_error").length,
    ).toBeGreaterThan(0);
  },
};

export const ARefusedRequestSentAgain: Story = {
  ...page(pathOf(refusedRequest), refusedAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "another request" }),
    ).toHaveAttribute("href", `/requests/${divertedRequest}`);
    await expect(canvas.getByText("Refused 429")).toBeVisible();
  },
};

export const ADivertedRequest: Story = {
  ...page(pathOf(divertedRequest), divertedAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "the refused request" }),
    ).toHaveAttribute("href", `/requests/${refusedRequest}`);
  },
};

export const AModelListing: Story = {
  ...page(pathOf(listingRequest), listingAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("There is no conversation."),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: /^The body as the hub forwarded it/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Session" }),
    ).not.toBeInTheDocument();
  },
};

export const UsageNotReported: Story = {
  ...page(pathOf(unreportedRequest, "usage"), unreportedAnswers),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText("not reported")).length,
    ).toBeGreaterThan(5);
  },
};

export const CutText: Story = {
  ...page(pathOf(cutRequest), cutAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        /241,388 characters were left out of this request's texts/,
      ),
    ).toBeVisible();
  },
};

export const AnImportedRequest: Story = {
  ...page(pathOf(importedRequest), importedAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        /Imported from a Bifrost log: its conversation is as Bifrost logged it, not what the client sent\./,
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: /^The body as Bifrost logged it/,
      }),
    ).toHaveAttribute("href", `/api/requests/${importedRequest}/body`);
    await expect(
      canvas.queryByRole("button", {
        name: /^The body as the hub forwarded it/,
      }),
    ).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  ...page(pathOf(answeredRequest), loadingRequest),
};

export const Failed: Story = {
  ...page(pathOf(answeredRequest), failedRead),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read this request."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const NotFound: Story = {
  ...page(pathOf(missingId), missingRequest),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("There is no such request."),
    ).toBeVisible();
    await expect(canvas.getByText(missingId)).toBeVisible();
  },
};

export const Narrow: Story = {
  ...page(pathOf(answeredRequest), answeredAnswers),
  globals: { viewport: { value: "mobile2" } },
};

export const NarrowFailed: Story = {
  ...page(pathOf(failedRequest), failedAnswers),
  globals: { viewport: { value: "mobile2" } },
};
