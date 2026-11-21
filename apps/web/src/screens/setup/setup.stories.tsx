import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import {
  asked,
  never,
  noContent,
  once,
  problem,
  unreachable,
} from "#stories/fake-api.ts";
import {
  displayNames,
  owner,
  passwordOnly,
  signsInWith,
} from "#stories/fixtures.ts";
import { locationShown, page } from "#stories/page.tsx";

const meta = { title: "Screens/Setup" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const nobody = problem("sign-in", "me", {
  type: "urn:cota:sign-in-required",
  status: 401,
});

const notSetUp = signsInWith({ setUp: false, password: false, passkey: false });

const wrongCode = problem("sign-in", "setUp", {
  type: "urn:cota:wrong-setup-code",
  status: 401,
});

const narrow = { viewport: { value: "mobile2" } };

const fill = async (
  canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"],
  userEvent: Parameters<NonNullable<Story["play"]>>[0]["userEvent"],
  code = "K7QM-2F9X-HD3P",
  password = "correct horse battery staple",
) => {
  await userEvent.type(await canvas.findByLabelText("Setup code"), code);
  await userEvent.type(canvas.getByLabelText("Owner password"), password);
};

const stepsOf = (canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"]) =>
  canvas
    .getAllByRole("listitem")
    .map((step) => step.textContent?.match(/Step \d, [a-z ]+/)?.[0]);

export const Empty: Story = {
  ...page("/setup", [nobody, notSetUp]),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Set up this hub" }),
    ).toBeVisible();
    await expect(canvas.getByLabelText("Setup code")).toHaveFocus();
    await expect(canvas.getByText("XXXX-XXXX-XXXX")).toBeVisible();
    await expect(stepsOf(canvas)).toEqual([
      "Step 1, now",
      "Step 2, to come",
      "Step 3, to come",
    ]);
  },
};

export const Filled: Story = {
  ...page("/setup", [nobody, notSetUp]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await expect(
      canvas.getByLabelText("Owner password"),
    ).toHaveAccessibleDescription(/^12 characters or more\s?: met$/);
    await expect(stepsOf(canvas)).toEqual([
      "Step 1, done",
      "Step 2, done",
      "Step 3, to come",
    ]);
  },
};

export const Submitting: Story = {
  ...page("/setup", [nobody, notSetUp, never("sign-in", "setUp")]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Setting up…" }),
    ).toBeDisabled();
  },
};

export const ACodeAsTypedIsSentAsTheHubReadsIt: Story = {
  ...page("/setup", [
    once(nobody),
    owner,
    displayNames,
    once(notSetUp),
    passwordOnly,
    asked(noContent("sign-in", "setUp"), (body) =>
      typeof body === "object" && body !== null && "code" in body
        ? body.code === "K7QM2F9XHD30"
        : false,
    ),
  ]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent, "k7qm 2f9x hd3o");
    await expect(canvas.getByLabelText("Setup code")).toHaveValue(
      "K7QM-2F9X-HD30",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Pools" }),
    ).toBeVisible();
    await expect(locationShown().pathname).toBe("/");
  },
};

export const RefusedCode: Story = {
  ...page("/setup", [nobody, notSetUp, wrongCode]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent, "K7QM-2F9X-HD3B");
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    const field = canvas.getByLabelText("Setup code");
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "That is not this hub's setup code. It is in the hub's log, printed when it started; a restart makes a new one.",
    );
    await waitFor(() => expect(field).toHaveFocus());
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveValue("K7QM-2F9X-HD3B");
    await expect(stepsOf(canvas)[0]).toBe("Step 1, refused");
  },
};

export const Paused: Story = {
  ...page("/setup", [
    nobody,
    notSetUp,
    problem(
      "sign-in",
      "setUp",
      {
        type: "urn:cota:too-many-attempts",
        status: 429,
        detail: "Setting up is paused for 540 seconds.",
      },
      { "retry-after": "540" },
    ),
  ]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      /Setting up is paused until/,
    );
    await expect(
      canvas.getByRole("button", { name: /^Set up again in [89]m$/ }),
    ).toBeDisabled();
  },
};

export const AShortPasswordIsNotSent: Story = {
  ...page("/setup", [nobody, notSetUp]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent, "K7QM-2F9X-HD3P", "horse");
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "12 characters or more; this one is 5, so it was not sent.",
    );
    await expect(canvas.getByLabelText("Owner password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(canvas.getAllByRole("alert")).toHaveLength(1);
  },
};

export const AShortCodeIsNotSent: Story = {
  ...page("/setup", [nobody, notSetUp]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent, "K7QM-2F9");
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "A setup code has 12 characters; this one has 7, so it was not sent.",
    );
  },
};

const alreadySetUp = problem("sign-in", "setUp", {
  type: "urn:cota:already-set-up",
  status: 409,
});

export const AlreadySetUp: Story = {
  ...page("/setup", [nobody, notSetUp, alreadySetUp]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This hub is set up already.",
    );
  },
};

export const AlreadySetUpLeadsToSignIn: Story = {
  ...page("/setup", [nobody, once(notSetUp), passwordOnly, alreadySetUp]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in" }),
    );
    await expect(await canvas.findByLabelText("Owner password")).toBeVisible();
    await expect(locationShown().pathname).toBe("/sign-in");
  },
};

export const HubDidNotAnswer: Story = {
  ...page("/setup", [nobody, notSetUp, unreachable("sign-in", "setUp")]),
  play: async ({ canvas, userEvent }) => {
    await fill(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Set up the hub" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The hub did not answer.",
    );
    await expect(canvas.getByLabelText("Setup code")).toHaveValue(
      "K7QM-2F9X-HD3P",
    );
  },
};

export const WaysInUnanswered: Story = {
  ...page("/setup", [nobody, unreachable("sign-in", "waysIn")]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The hub did not answer.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
  },
};

export const ASetUpHubLeadsToSignIn: Story = {
  ...page("/setup", [nobody, passwordOnly]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText("Owner password")).toBeVisible();
    await expect(locationShown().pathname).toBe("/sign-in");
  },
};

export const SignInLeadsToSetup: Story = {
  ...page("/", [nobody, notSetUp]),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Set up this hub" }),
    ).toBeVisible();
    await expect(locationShown().pathname).toBe("/setup");
  },
};

export const Narrow: Story = {
  ...page("/setup", [nobody, notSetUp]),
  globals: narrow,
};

export const NarrowRefused: Story = {
  ...RefusedCode,
  globals: narrow,
};
