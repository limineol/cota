import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import {
  answer,
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
import { page } from "#stories/page.tsx";
import { signedAnswer, standIn } from "#stories/passkeys.ts";

const meta = { title: "Screens/Sign in" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const nobody = problem("sign-in", "me", {
  type: "urn:cota:sign-in-required",
  status: 401,
});

const signedOut = [nobody, passwordOnly];

const passwordAndPasskey = signsInWith({
  setUp: true,
  password: true,
  passkey: true,
});

const passkeyOnly = signsInWith({
  setUp: true,
  password: false,
  passkey: true,
});

const requestOptions = answer("sign-in", "preparePasskeySignIn", {
  challenge: "q1w2e3r4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  rpId: "cota.example",
  timeout: 300000,
  userVerification: "required",
});

const notAccepted = problem("sign-in", "signInWithPasskey", {
  type: "urn:cota:passkey-refused",
  status: 401,
});

const atTheLoopback = standIn({
  offered: false,
  address: "http://127.0.0.1:18080",
});

const narrow = { viewport: { value: "mobile2" } };

const wrongPassword = problem("sign-in", "signIn", {
  type: "urn:cota:wrong-password",
  status: 401,
});

export const Idle: Story = {
  ...page("/", signedOut),
  play: async ({ canvas }) => {
    const field = await canvas.findByLabelText("Owner password");
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("autocomplete", "current-password");
    await expect(field).toHaveFocus();
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeEnabled();
  },
};

export const Submitting: Story = {
  ...page("/", [...signedOut, never("sign-in", "signIn")]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Owner password"),
      "correct horse{Enter}",
    );
    await expect(
      await canvas.findByRole("button", { name: "Signing in…" }),
    ).toBeDisabled();
  },
};

export const WrongPassword: Story = {
  ...page("/", [...signedOut, wrongPassword]),
  play: async ({ canvas, userEvent }) => {
    const field = await canvas.findByLabelText("Owner password");
    await userEvent.type(field, "wrong horse");
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "That is not the owner password.",
    );
    await waitFor(() => expect(field).toHaveFocus());
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(
      /That is not the owner password/,
    );
  },
};

export const Locked: Story = {
  ...page("/", [
    ...signedOut,
    problem(
      "sign-in",
      "signIn",
      {
        type: "urn:cota:too-many-attempts",
        status: 429,
        detail: "Signing in is paused for 540 seconds.",
      },
      { "retry-after": "540" },
    ),
  ]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Owner password"),
      "eleventh guess{Enter}",
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      /Signing in is paused until/,
    );
    await expect(
      canvas.getByRole("button", { name: /^Sign in again in [89]m$/ }),
    ).toBeDisabled();
  },
};

export const HubDidNotAnswer: Story = {
  ...page("/", [...signedOut, unreachable("sign-in", "signIn")]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Owner password"),
      "correct horse{Enter}",
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The hub did not answer.",
    );
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeEnabled();
  },
};

export const WrongThenRight: Story = {
  ...page("/", [
    once(nobody),
    owner,
    displayNames,
    passwordOnly,
    once(wrongPassword),
    noContent("sign-in", "signIn"),
  ]),
  play: async ({ canvas, userEvent }) => {
    const field = await canvas.findByLabelText("Owner password");
    await userEvent.type(field, "wrong horse{Enter}");
    await canvas.findByRole("alert");
    await userEvent.type(field, "correct horse{Enter}");
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Pools" }),
    ).toBeVisible();
  },
};

export const PasswordAndPasskey: Story = {
  ...page("/", [nobody, passwordAndPasskey]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText("Owner password")).toHaveFocus();
    await expect(canvas.getByText("or", { exact: true })).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
  },
};

export const PasskeyOnly: Story = {
  ...page("/", [nobody, passkeyOnly]),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
    await expect(canvas.queryByLabelText("Owner password")).toBeNull();
    await expect(canvas.queryByText("or", { exact: true })).toBeNull();
  },
};

export const PasskeyOnlyAtAnAddressWithout: Story = {
  ...page("/", [nobody, passkeyOnly], atTheLoopback),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      /signed in to with a passkey only.*http:\/\/127\.0\.0\.1:18080/,
    );
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByLabelText("Owner password")).toBeNull();
  },
};

export const PasswordAtAnAddressWithoutPasskeys: Story = {
  ...page("/", [nobody, passwordAndPasskey], atTheLoopback),
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText("Owner password")).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Sign in with a passkey" }),
    ).toBeNull();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const PasskeyWaitsForTheBrowser: Story = {
  ...page(
    "/",
    [nobody, passwordAndPasskey, requestOptions],
    standIn({ signIn: "waits" }),
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Waiting for the browser…" }),
    ).toBeDisabled();
  },
};

export const PasskeyCancelled: Story = {
  ...page(
    "/",
    [nobody, passkeyOnly, requestOptions],
    standIn({ signIn: "Cancelled" }),
  ),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole("button", {
      name: "Sign in with a passkey",
    });
    await userEvent.click(button);
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "No passkey was given: the browser's prompt was closed.",
    );
    await expect(
      canvas.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
  },
};

export const PasskeyNotAccepted: Story = {
  ...page("/", [nobody, passwordAndPasskey, requestOptions, notAccepted]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("The passkey was not accepted.");
    await expect(alert).toHaveTextContent(/or sign in with the owner password/);
    await expect(canvas.getByLabelText("Owner password")).toBeVisible();
  },
};

export const PasskeyNotAcceptedWithoutAPassword: Story = {
  ...page("/", [nobody, passkeyOnly, requestOptions, notAccepted]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("The passkey was not accepted.");
    await expect(alert).not.toHaveTextContent(/password/);
  },
};

export const TryAgainAfterARefusal: Story = {
  ...page("/", [
    once(nobody),
    owner,
    displayNames,
    passkeyOnly,
    requestOptions,
    once(notAccepted),
    noContent("sign-in", "signInWithPasskey"),
  ]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Pools" }),
    ).toBeVisible();
  },
};

export const SignsInWithAPasskey: Story = {
  ...page("/", [
    once(nobody),
    owner,
    displayNames,
    passwordAndPasskey,
    requestOptions,
    asked(noContent("sign-in", "signInWithPasskey"), (body) =>
      typeof body === "object" &&
      body !== null &&
      "id" in body &&
      "response" in body
        ? body.id === signedAnswer.id &&
          JSON.stringify(body.response) ===
            JSON.stringify(signedAnswer.response)
        : false,
    ),
  ]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Pools" }),
    ).toBeVisible();
  },
};

export const PasswordTurnedOffMeanwhile: Story = {
  ...page("/", [
    nobody,
    once(passwordAndPasskey),
    passkeyOnly,
    problem("sign-in", "signIn", {
      type: "urn:cota:password-off",
      status: 403,
    }),
  ]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Owner password"),
      "correct horse{Enter}",
    );
    await waitFor(() =>
      expect(canvas.queryByLabelText("Owner password")).toBeNull(),
    );
    await expect(
      canvas.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
  },
};

export const PasskeysRemovedMeanwhile: Story = {
  ...page("/", [
    nobody,
    once(passwordAndPasskey),
    passwordOnly,
    problem("sign-in", "preparePasskeySignIn", {
      type: "urn:cota:no-passkeys",
      status: 409,
    }),
  ]),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    await waitFor(() =>
      expect(
        canvas.queryByRole("button", { name: "Sign in with a passkey" }),
      ).toBeNull(),
    );
    await expect(canvas.getByLabelText("Owner password")).toBeVisible();
  },
};

export const WaysInUnanswered: Story = {
  ...page("/", [nobody, unreachable("sign-in", "waysIn")]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The hub did not answer.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
  },
};

export const Narrow: Story = {
  ...page("/", [nobody, passwordAndPasskey]),
  globals: narrow,
};

export const NarrowPasskeyNotAccepted: Story = {
  ...page("/", [nobody, passwordAndPasskey, requestOptions, notAccepted]),
  globals: narrow,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign in with a passkey" }),
    );
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};
