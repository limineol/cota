import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, waitFor, within } from "storybook/test";
import { locationShown, page, withApi } from "#stories/page.tsx";
import { madeAnswer, standIn } from "#stories/passkeys.ts";
import {
  addingAtNoPasskeyOrigin,
  addingOne,
  addingRefused,
  changePaused,
  changing,
  creationOptions,
  endingOne,
  endingTheOthers,
  forgettingOne,
  keyedOnly,
  lastPasskey,
  namesBeforeAndAfter,
  namesFailed,
  namesLoading,
  nothingSeen,
  onlyThisBrowser,
  poolsFailed,
  poolsLoading,
  quotaLogins,
  removedAt,
  removedElsewhere,
  removingOne,
  replaced,
  setAt,
  setRefused,
  settingOne,
  settings,
  signIns,
  signInsFailed,
  signInsLoading,
  threePasskeys,
  turnedOffElsewhere,
  turningOff,
  waysIn,
  waysInFailed,
  waysInLoading,
} from "#stories/settings.ts";
import { Names } from "./names.tsx";
import { OwnerPassword } from "./owner-password.tsx";
import { Passkeys } from "./passkeys.tsx";
import { QuotaLogins } from "./quota-logins.tsx";
import { SignIns } from "./sign-ins.tsx";

const meta = { title: "Screens/Settings" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = { viewport: { value: "mobile2" } };

const rowOf = async (
  canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"],
  table: string,
  name: RegExp | string,
) => {
  const found = await canvas.findByRole("table", { name: table });
  const cell = await within(found).findByText(name);
  const row = cell.closest("tr");
  if (row === null) throw new Error("The text is in no row.");
  return within(row);
};

export const LeadsToDisplayNames: Story = {
  ...page("/settings", settings()),
  play: async ({ canvas }) => {
    await canvas.findByRole("table", { name: "Display names" });
    await expect(locationShown().pathname).toBe("/settings/names");
    await expect(
      canvas.getByRole("link", { name: "Display names" }),
    ).toHaveAttribute("aria-current", "page");
  },
};

export const Pools: Story = {
  ...page("/settings/names", settings()),
  play: async ({ canvas }) => {
    const table = await canvas.findByRole("table", { name: "Display names" });
    await expect(within(table).getAllByRole("row")).toHaveLength(7);
    await expect(
      canvas.getByRole("textbox", { name: "Display name of solo" }),
    ).toHaveValue("Solo plan");
    await expect(canvas.getByText("6 pools, 1 named by you")).toBeVisible();
  },
};

export const Models: Story = {
  ...page("/settings/names?kind=model", settings()),
  play: async ({ canvas }) => {
    const retired = await rowOf(canvas, "Display names", "retired-model");
    await expect(
      retired.getByRole("textbox", { name: "Display name of retired-model" }),
    ).toHaveValue("The retired one");
    await expect(retired.getByText("0")).toBeInTheDocument();
    await expect(
      canvas.getByRole("textbox", { name: "Display name of claude-opus-4-5" }),
    ).toHaveValue("Claude Opus 4.5");
  },
};

export const Clients: Story = {
  ...page("/settings/names?kind=client", settings()),
  play: async ({ canvas }) => {
    const opencode = await rowOf(canvas, "Display names", "opencode");
    await expect(
      opencode.getByRole("textbox", { name: "Display name of opencode" }),
    ).toHaveValue("");
  },
};

export const Machines: Story = {
  ...page("/settings/names?kind=machine", settings()),
  play: async ({ canvas }) => {
    await canvas.findByRole("table", { name: "Display names" });
    await expect(
      canvas.getByRole("textbox", { name: "Display name of rig%25" }),
    ).toBeVisible();
  },
};

export const Projects: Story = {
  ...page("/settings/names?kind=project", settings()),
  play: async ({ canvas }) => {
    await canvas.findByRole("table", { name: "Display names" });
    await expect(
      canvas.getByRole("textbox", { name: "Display name of acme/shop" }),
    ).toBeVisible();
  },
};

export const Filtered: Story = {
  ...page("/settings/names?kind=model&filter=claude", settings()),
  play: async ({ canvas, userEvent }) => {
    const table = await canvas.findByRole("table", { name: "Display names" });
    await expect(within(table).getAllByRole("row")).toHaveLength(3);
    const filter = canvas.getByRole("searchbox", {
      name: "Filter models by id or name",
    });
    await userEvent.clear(filter);
    await userEvent.type(filter, "nothing like it");
    await expect(
      await canvas.findByText("No model's id or name holds “nothing like it”."),
    ).toBeVisible();
  },
};

export const AnIdWithNoName: Story = {
  ...page("/settings/names?kind=machine", settings()),
  play: async ({ canvas }) => {
    const laptop = await rowOf(canvas, "Display names", "laptop");
    const field = laptop.getByRole("textbox", {
      name: "Display name of laptop",
    });
    await expect(field).toHaveValue("");
    await expect(field).toHaveAttribute("placeholder", "laptop");
    await expect(
      laptop.queryByRole("button", { name: /Reset/ }),
    ).not.toBeInTheDocument();
  },
};

export const BeingEdited: Story = {
  ...page("/settings/names?kind=machine", settings()),
  play: async ({ canvas, userEvent }) => {
    const desk = await rowOf(canvas, "Display names", "desk");
    const field = desk.getByRole("textbox", { name: "Display name of desk" });
    await userEvent.clear(field);
    await userEvent.type(field, "Studio desk");
    await expect(desk.getByRole("button", { name: "Save" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(field).toHaveValue("Desk");
    await expect(
      desk.getByRole("button", { name: "Reset the name of desk" }),
    ).toBeVisible();
  },
};

export const Saved: Story = {
  ...page(
    "/settings/names?kind=machine",
    settings(
      namesBeforeAndAfter(
        replaced("machine", "laptop", {
          kind: "machine",
          key: "laptop",
          name: "Travel laptop",
          source: "owner",
        }),
      ),
      [
        setAt("/api/display-names/machine/laptop", "Travel laptop", {
          kind: "machine",
          key: "laptop",
          name: "Travel laptop",
          source: "owner",
        }),
      ],
    ),
  ),
  play: async ({ canvas, userEvent }) => {
    const laptop = await rowOf(canvas, "Display names", "laptop");
    const field = laptop.getByRole("textbox", {
      name: "Display name of laptop",
    });
    await userEvent.type(field, "  Travel laptop {Enter}");
    await expect(await laptop.findByText("Saved.")).toBeVisible();
    await expect(field).toHaveValue("Travel laptop");
    await expect(
      await laptop.findByRole("button", { name: "Reset the name of laptop" }),
    ).toBeVisible();
    await expect(laptop.getByText("Yours")).toBeInTheDocument();
  },
};

export const AKeyWithASlash: Story = {
  ...page(
    "/settings/names?kind=project",
    settings(namesBeforeAndAfter(settingsAfterShop()), [
      setAt("/api/display-names/project/acme%2Fshop", "Shop", {
        kind: "project",
        key: "acme/shop",
        name: "Shop",
        source: "owner",
      }),
    ]),
  ),
  play: async ({ canvas, userEvent }) => {
    const shop = await rowOf(canvas, "Display names", "acme/shop");
    await userEvent.click(
      shop.getByRole("textbox", { name: "Display name of acme/shop" }),
    );
    await userEvent.keyboard("Shop");
    await userEvent.click(shop.getByRole("button", { name: "Save" }));
    await expect(await shop.findByText("Saved.")).toBeVisible();
  },
};

function settingsAfterShop() {
  return replaced("project", "acme/shop", {
    kind: "project",
    key: "acme/shop",
    name: "Shop",
    source: "owner",
  });
}

export const AKeyWithAPercentSign: Story = {
  ...page(
    "/settings/names?kind=machine",
    settings(
      namesBeforeAndAfter(
        replaced("machine", "rig%25", {
          kind: "machine",
          key: "rig%25",
          name: "Render rig",
          source: "owner",
        }),
      ),
      [
        setAt("/api/display-names/machine/rig%2525", "Render rig", {
          kind: "machine",
          key: "rig%25",
          name: "Render rig",
          source: "owner",
        }),
      ],
    ),
  ),
  play: async ({ canvas, userEvent }) => {
    const rig = await rowOf(canvas, "Display names", "rig%25");
    await userEvent.type(
      rig.getByRole("textbox", { name: "Display name of rig%25" }),
      "Render rig{Enter}",
    );
    await expect(await rig.findByText("Saved.")).toBeVisible();
  },
};

export const RefusedTooLong: Story = {
  ...page("/settings/names?kind=machine", settings()),
  play: async ({ canvas, userEvent }) => {
    const laptop = await rowOf(canvas, "Display names", "laptop");
    const field = laptop.getByRole("textbox", {
      name: "Display name of laptop",
    });
    const long =
      "A laptop whose name runs on and on, well past the eighty characters that a name keeps";
    await userEvent.type(field, `${long}{Enter}`);
    await expect(laptop.getByRole("alert")).toHaveTextContent(
      `A display name is at most 80 characters; this one is ${[...long].length}.`,
    );
    await expect(field).toHaveValue(long);
    await expect(field).toHaveAttribute("aria-invalid", "true");
  },
};

export const RefusedByTheHub: Story = {
  ...page(
    "/settings/names?kind=machine",
    settings(undefined, [setRefused("/api/display-names/machine/laptop")]),
  ),
  play: async ({ canvas, userEvent }) => {
    const laptop = await rowOf(canvas, "Display names", "laptop");
    const field = laptop.getByRole("textbox", {
      name: "Display name of laptop",
    });
    await userEvent.type(field, "Travel laptop{Enter}");
    await expect(await laptop.findByRole("alert")).toHaveTextContent(
      "Not saved: The hub store could not be written: the disk is full.",
    );
    await expect(field).toHaveValue("Travel laptop");
  },
};

export const ANameThatIsItsId: Story = {
  ...page(
    "/settings/names?kind=machine",
    settings(namesBeforeAndAfter(replaced("machine", "desk", null)), [
      setAt("/api/display-names/machine/desk", "desk", {
        kind: "machine",
        key: "desk",
        name: "desk",
        source: "built-in",
      }),
    ]),
  ),
  play: async ({ canvas, userEvent }) => {
    const desk = await rowOf(canvas, "Display names", "desk");
    const field = desk.getByRole("textbox", { name: "Display name of desk" });
    await userEvent.clear(field);
    await userEvent.type(field, "desk{Enter}");
    await expect(
      await desk.findByText("That is its id, so your name is removed."),
    ).toBeVisible();
    await expect(field).toHaveValue("");
  },
};

export const Reset: Story = {
  ...page(
    "/settings/names?kind=model",
    settings(namesBeforeAndAfter(replaced("model", "glm-4.6", null)), [
      removedAt("/api/display-names/model/glm-4.6"),
    ]),
  ),
  play: async ({ canvas, userEvent }) => {
    const glm = await rowOf(canvas, "Display names", "glm-4.6");
    await userEvent.click(
      glm.getByRole("button", { name: "Reset the name of glm-4.6" }),
    );
    await expect(await glm.findByText("Your name is removed.")).toBeVisible();
    await expect(
      glm.getByRole("textbox", { name: "Display name of glm-4.6" }),
    ).toHaveValue("");
    await expect(glm.getByText("None")).toBeInTheDocument();
  },
};

export const NoneSeenYet: Story = {
  ...page("/settings/names", nothingSeen),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No pool has been seen yet."),
    ).toBeVisible();
  },
};

export const NamesLoading: Story = {
  ...page("/settings/names", namesLoading),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("table", { name: "Display names loading" }),
    ).toBeVisible();
  },
};

export const NamesFailed: Story = {
  ...page("/settings/names", namesFailed),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the display names."),
    ).toBeVisible();
    await expect(
      canvas.getByText("ClickHouse did not answer within 30 seconds."),
    ).toBeVisible();
  },
};

export const NamesNarrow: Story = {
  ...page("/settings/names?kind=model", settings()),
  globals: narrow,
};

export const NamesForAReaderKey: Story = {
  decorators: [withApi(settings())],
  render: () => (
    <Names
      owner={false}
      kind="pool"
      filter=""
      onKindChange={() => {}}
      onFilterChange={() => {}}
    />
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Solo plan")).toBeVisible();
    await expect(
      canvas.queryByRole("textbox", { name: /Display name of/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/A reader key reads display names but cannot change/),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /Reset|Save/ }),
    ).not.toBeInTheDocument();
  },
};

export const SignInsOfFourBrowsers: Story = {
  ...page("/settings/sign-ins", signIns),
  play: async ({ canvas }) => {
    const table = await canvas.findByRole("table", { name: "Sign-ins" });
    const rows = within(table).getAllByRole("row");
    await expect(rows).toHaveLength(5);
    const [, first, second, third, fourth] = rows;
    await expect(first).toHaveTextContent(/^Firefox on macOSThis browser/);
    await expect(second).toHaveTextContent(/^Chrome on Windows/);
    await expect(third).toHaveTextContent(/^Safari on iOS/);
    await expect(fourth).toHaveTextContent(/^Edge on Android/);
    await expect(
      within(table).getAllByRole("button", { name: /^End the sign-in/ }),
    ).toHaveLength(3);
    await expect(within(table).getByText("Sign out ends it")).toBeVisible();
  },
};

export const OnlyThisBrowser: Story = {
  ...page("/settings/sign-ins", onlyThisBrowser),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Only this browser is signed in."),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /End all others/ }),
    ).not.toBeInTheDocument();
  },
};

export const EndingOne: Story = {
  ...page("/settings/sign-ins", endingOne),
  play: async ({ canvas, userEvent }) => {
    const chrome = await rowOf(canvas, "Sign-ins", "Chrome on Windows");
    await userEvent.click(
      chrome.getByRole("button", { name: /^End the sign-in of Chrome/ }),
    );
    await waitFor(() =>
      expect(canvas.queryByText("Chrome on Windows")).not.toBeInTheDocument(),
    );
    await expect(
      canvas.getByText("This browser and 2 others, newest first."),
    ).toBeVisible();
  },
};

export const EndingAllOthers: Story = {
  ...page("/settings/sign-ins", endingTheOthers),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "End all others (3)" }),
    );
    const asked = canvas.getByRole("group", {
      name: /^End the 3 other sign-ins\?/,
    });
    await expect(
      within(asked).getByRole("button", { name: "Keep them" }),
    ).toHaveFocus();
    await userEvent.click(
      within(asked).getByRole("button", { name: "End them" }),
    );
    await expect(
      await canvas.findByText(
        "3 sign-ins ended. Only this browser is signed in.",
      ),
    ).toBeVisible();
    const table = canvas.getByRole("table", { name: "Sign-ins" });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
  },
};

export const SignInsLoading: Story = {
  ...page("/settings/sign-ins", signInsLoading),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("table", { name: "Sign-ins loading" }),
    ).toBeVisible();
  },
};

export const SignInsFailed: Story = {
  ...page("/settings/sign-ins", signInsFailed),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not list the sign-ins."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const SignInsNarrow: Story = {
  ...page("/settings/sign-ins", signIns),
  globals: narrow,
};

export const SignInsForAReaderKey: Story = {
  decorators: [withApi(settings())],
  render: () => <SignIns owner={false} />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("A reader key cannot see the owner's sign-ins."),
    ).toBeVisible();
    await expect(canvas.queryByRole("table")).not.toBeInTheDocument();
  },
};

export const QuotaLoginsOfEveryState: Story = {
  ...page("/settings/quota-logins", quotaLogins),
  play: async ({ canvas }) => {
    const solo = await rowOf(canvas, "Quota logins", "Solo plan");
    await expect(solo.getByText("Kept")).toBeVisible();
    await expect(solo.getByText("Max 5x")).toBeVisible();
    const codex = await rowOf(canvas, "Quota logins", "codex");
    await expect(codex.getByText(/not refreshed yet/)).toBeVisible();
    const spare = await rowOf(canvas, "Quota logins", "spare");
    await expect(spare.getByText("Expired")).toBeVisible();
    await expect(canvas.getByText("bun run quota:connect spare")).toBeVisible();
    await expect(canvas.getByText("bun run quota:connect night")).toBeVisible();
    await expect(
      canvas.getAllByText(/a Claude login is connected from macOS only/),
    ).toHaveLength(2);
    await expect(
      canvas.queryByText(/quota:connect solo/),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("zai")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const Forgetting: Story = {
  ...page("/settings/quota-logins", forgettingOne),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Forget the quota login of Solo plan",
      }),
    );
    const asked = canvas.getByRole("group", {
      name: /^Forget the quota login of Solo plan\? The hub stops reading its quota windows/,
    });
    await userEvent.click(
      within(asked).getByRole("button", { name: "Forget it" }),
    );
    await expect(
      await canvas.findByText("bun run quota:connect solo"),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", {
        name: "Forget the quota login of Solo plan",
      }),
    ).not.toBeInTheDocument();
  },
};

export const CopyingTheCommand: Story = {
  ...page("/settings/quota-logins", quotaLogins),
  play: async ({ canvas, userEvent }) => {
    const write = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Copy the command that gives night a quota login",
      }),
    );
    await expect(write).toHaveBeenCalledWith("bun run quota:connect night");
    await expect(
      await canvas.findByText(
        "The command that gives night a quota login is copied.",
      ),
    ).toBeInTheDocument();
    write.mockRestore();
  },
};

export const NoPoolTakesOne: Story = {
  ...page("/settings/quota-logins", keyedOnly),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No pool of this hub takes a quota login."),
    ).toBeVisible();
  },
};

export const QuotaLoginsLoading: Story = {
  ...page("/settings/quota-logins", poolsLoading),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("table", { name: "Quota logins loading" }),
    ).toBeVisible();
  },
};

export const QuotaLoginsFailed: Story = {
  ...page("/settings/quota-logins", poolsFailed),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not list its pools."),
    ).toBeVisible();
  },
};

export const QuotaLoginsNarrow: Story = {
  ...page("/settings/quota-logins", quotaLogins),
  globals: narrow,
};

export const QuotaLoginsForAReaderKey: Story = {
  decorators: [withApi(settings())],
  render: () => <QuotaLogins owner={false} />,
  play: async ({ canvas }) => {
    await canvas.findByRole("table", { name: "Quota logins" });
    await expect(
      canvas.queryByRole("button", { name: /^Forget/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText(/bun run quota:connect/),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/A reader key sees each pool's quota login/),
    ).toBeVisible();
  },
};

const passwordPanel = (
  canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"],
) => canvas.findByRole("region", { name: "Owner password" });

export const PasswordInThisHub: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", threePasskeys)),
  play: async ({ canvas }) => {
    const panel = within(await passwordPanel(canvas));
    await expect(
      await panel.findByText(/^Kept in this hub, set /),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "Change" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Turn off" })).toBeVisible();
  },
};

export const PasswordInTheConfiguration: Story = {
  ...page("/settings/sign-ins", waysIn("configuration", threePasskeys)),
  play: async ({ canvas }) => {
    const panel = within(await passwordPanel(canvas));
    await expect(
      await panel.findByText(
        "Kept in the hub's configuration. It is changed in the configuration file, and it wins over one set here.",
      ),
    ).toBeVisible();
    await expect(panel.queryByRole("button")).not.toBeInTheDocument();
  },
};

export const PasswordOff: Story = {
  ...page("/settings/sign-ins", waysIn("none", threePasskeys)),
  play: async ({ canvas }) => {
    const panel = within(await passwordPanel(canvas));
    await expect(
      await panel.findByText(
        "Off: the hub is signed in to with a passkey only.",
      ),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Set a password" }),
    ).toBeVisible();
  },
};

export const ChangingThePassword: Story = {
  ...page("/settings/sign-ins", changing("correct horse")),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(await panel.findByRole("button", { name: "Change" }));
    await userEvent.type(
      panel.getByLabelText("Current password"),
      "correct horse",
    );
    await userEvent.type(
      panel.getByLabelText("New password"),
      "battery staple of the hub",
    );
    await expect(panel.getByText(/12 characters or more/)).toHaveTextContent(
      ": met",
    );
    await userEvent.click(
      panel.getByRole("button", { name: "Change the password" }),
    );
    await expect(
      await panel.findByText("Changed. Every other sign-in was ended."),
    ).toBeVisible();
    await waitFor(() =>
      expect(canvas.getByText("Only this browser is signed in.")).toBeVisible(),
    );
  },
};

export const ChangingWithAWrongCurrentPassword: Story = {
  ...page("/settings/sign-ins", changing("correct horse")),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(await panel.findByRole("button", { name: "Change" }));
    const current = panel.getByLabelText("Current password");
    await userEvent.type(current, "wrong horse");
    await userEvent.type(
      panel.getByLabelText("New password"),
      "battery staple of the hub",
    );
    await userEvent.click(
      panel.getByRole("button", { name: "Change the password" }),
    );
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      "That is not the current password.",
    );
    await expect(current).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(current).toHaveFocus());
    await expect(panel.getByLabelText("New password")).toHaveValue(
      "battery staple of the hub",
    );
  },
};

export const ChangingWhilePaused: Story = {
  ...page("/settings/sign-ins", changePaused),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(await panel.findByRole("button", { name: "Change" }));
    await userEvent.type(panel.getByLabelText("Current password"), "a guess");
    await userEvent.type(
      panel.getByLabelText("New password"),
      "battery staple of the hub",
    );
    await userEvent.click(
      panel.getByRole("button", { name: "Change the password" }),
    );
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /^Changing the password is paused until .+: too many wrong passwords/,
    );
  },
};

export const AShortPasswordIsNotSent: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", threePasskeys)),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(await panel.findByRole("button", { name: "Change" }));
    await userEvent.type(panel.getByLabelText("Current password"), "anything");
    const field = panel.getByLabelText("New password");
    await userEvent.type(field, "short one");
    await userEvent.click(
      panel.getByRole("button", { name: "Change the password" }),
    );
    await expect(panel.getByRole("alert")).toHaveTextContent(
      "12 characters or more; this one is 9, so it was not sent.",
    );
    await expect(field).toHaveAttribute("aria-invalid", "true");
  },
};

export const TurningOffIsAsked: Story = {
  ...page("/settings/sign-ins", turningOff),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Turn off" }),
    );
    const asked = panel.getByRole("group", {
      name: /^Turn the owner password off\? The hub forgets it and is signed in to with a passkey only/,
    });
    await expect(
      within(asked).getByRole("button", { name: "Keep it" }),
    ).toHaveFocus();
  },
};

export const TurnedOff: Story = {
  ...page("/settings/sign-ins", turningOff),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Turn off" }),
    );
    await userEvent.click(panel.getByRole("button", { name: "Turn it off" }));
    await expect(
      await panel.findByText(
        "Off: the hub is signed in to with a passkey only.",
      ),
    ).toBeVisible();
    await expect(panel.getByText("Turned off.")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Set a password" }),
    ).toBeVisible();
  },
};

export const TurningOffIsNotOfferedWithoutAPasskey: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", [])),
  play: async ({ canvas }) => {
    const panel = within(await passwordPanel(canvas));
    await expect(
      await panel.findByText(
        /once a passkey is added: until then it is the only way in/,
      ),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: "Turn off" }),
    ).not.toBeInTheDocument();
  },
};

export const TurningOffAsAnotherBrowserRemovesThePasskey: Story = {
  ...page("/settings/sign-ins", turnedOffElsewhere),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Turn off" }),
    );
    await userEvent.click(panel.getByRole("button", { name: "Turn it off" }));
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /^Not turned off: the password is the last way in now/,
    );
    await expect(
      await panel.findByText(/once a passkey is added/),
    ).toBeVisible();
  },
};

export const SettingAPassword: Story = {
  ...page("/settings/sign-ins", settingOne),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passwordPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Set a password" }),
    );
    await expect(panel.queryByLabelText("Current password")).toBeNull();
    await userEvent.type(
      panel.getByLabelText("Owner password"),
      "battery staple of the hub",
    );
    await userEvent.click(
      panel.getByRole("button", { name: "Set the password" }),
    );
    await expect(
      await panel.findByText("Set. Every other sign-in was ended."),
    ).toBeVisible();
    await expect(
      await panel.findByText(/^Kept in this hub, set /),
    ).toBeVisible();
  },
};

export const WaysInLoading: Story = {
  ...page("/settings/sign-ins", waysInLoading),
};

export const WaysInFailed: Story = {
  ...page("/settings/sign-ins", waysInFailed),
  play: async ({ canvas }) => {
    const panel = within(await passwordPanel(canvas));
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      "The hub could not say where the password is kept: The hub store could not be read.",
    );
  },
};

export const WaysInNarrow: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", threePasskeys)),
  globals: narrow,
};

export const OwnerPasswordForAReaderKey: Story = {
  decorators: [withApi(settings())],
  render: () => <OwnerPassword owner={false} />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("A reader key cannot see the owner password."),
    ).toBeVisible();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

const passkeysPanel = (
  canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"],
) => canvas.findByRole("region", { name: "Passkeys" });

export const NoPasskeysYet: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", [])),
  play: async ({ canvas }) => {
    const panel = within(await passkeysPanel(canvas));
    await expect(
      await panel.findByText(
        /^None yet\. A passkey signs in with this browser/,
      ),
    ).toBeVisible();
    await expect(panel.queryByRole("table")).not.toBeInTheDocument();
    await expect(
      panel.getByRole("button", { name: "Add a passkey" }),
    ).toBeEnabled();
  },
};

export const ThreePasskeys: Story = {
  ...page("/settings/sign-ins", waysIn("hub-store", threePasskeys)),
  play: async ({ canvas }) => {
    const table = await canvas.findByRole("table", { name: "Passkeys" });
    const rows = within(table).getAllByRole("row");
    await expect(rows).toHaveLength(4);
    const [, first, second, third] = rows;
    await expect(first).toHaveTextContent(/^Chrome on macOS/);
    await expect(second).toHaveTextContent(/^Safari on iOS/);
    await expect(third).toHaveTextContent(/^Firefox on Windows/);
    await expect(third).toHaveTextContent(/localhost:4317/);
    await expect(
      within(table).getAllByRole("button", { name: /^Remove the passkey/ }),
    ).toHaveLength(3);
  },
};

export const AddingWaitsForTheBrowser: Story = {
  ...page(
    "/settings/sign-ins",
    waysIn("hub-store", threePasskeys, [creationOptions]),
    standIn({ make: "waits" }),
  ),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(
      await panel.findByRole("button", { name: "Waiting for the browser…" }),
    ).toBeDisabled();
  },
};

export const AddingMakesOne: Story = {
  ...page("/settings/sign-ins", addingOne(madeAnswer.id)),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(await panel.findByText("Added.")).toBeVisible();
    const table = panel.getByRole("table", { name: "Passkeys" });
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(5),
    );
    await expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      /^Firefox on macOS/,
    );
  },
};

export const AddingIsCancelled: Story = {
  ...page(
    "/settings/sign-ins",
    waysIn("hub-store", threePasskeys, [creationOptions]),
    standIn({ make: "Cancelled" }),
  ),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(
      await panel.findByText(
        "No passkey was made: the browser's prompt was closed.",
      ),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Add a passkey" }),
    ).toBeEnabled();
  },
};

export const AddingOneThatExists: Story = {
  ...page(
    "/settings/sign-ins",
    waysIn("hub-store", threePasskeys, [creationOptions]),
    standIn({ make: "Exists" }),
  ),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(
      await panel.findByText(/holds a passkey for this hub already/),
    ).toBeVisible();
  },
};

export const AddingRefusedByTheHub: Story = {
  ...page("/settings/sign-ins", addingRefused),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /^The hub did not take the passkey/,
    );
  },
};

export const ThisAddressCannotHavePasskeys: Story = {
  ...page(
    "/settings/sign-ins",
    waysIn("hub-store", threePasskeys),
    standIn({ offered: false, address: "http://127.0.0.1:18080" }),
  ),
  play: async ({ canvas }) => {
    const panel = within(await passkeysPanel(canvas));
    await expect(
      await panel.findByText(
        "This address cannot have a passkey: a browser offers passkeys only over https at a host name, or on localhost, and this page is at http://127.0.0.1:18080.",
      ),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: "Add a passkey" }),
    ).not.toBeInTheDocument();
  },
};

export const TheHubSaysThisAddressCannot: Story = {
  ...page(
    "/settings/sign-ins",
    addingAtNoPasskeyOrigin,
    standIn({ address: "http://127.0.0.1:18080" }),
  ),
  play: async ({ canvas, userEvent }) => {
    const panel = within(await passkeysPanel(canvas));
    await userEvent.click(
      await panel.findByRole("button", { name: "Add a passkey" }),
    );
    await expect(
      await panel.findByText(/^This address cannot have a passkey/),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: "Add a passkey" }),
    ).not.toBeInTheDocument();
  },
};

export const RemovingIsAsked: Story = {
  ...page("/settings/sign-ins", removingOne),
  play: async ({ canvas, userEvent }) => {
    const chrome = await rowOf(canvas, "Passkeys", "Chrome on macOS");
    await userEvent.click(
      chrome.getByRole("button", {
        name: /^Remove the passkey made in Chrome/,
      }),
    );
    const asked = canvas.getByRole("group", {
      name: /^Remove the passkey made in Chrome on macOS\? It no longer signs in/,
    });
    await expect(
      within(asked).getByRole("button", { name: "Keep it" }),
    ).toHaveFocus();
  },
};

export const RemovingOne: Story = {
  ...page("/settings/sign-ins", removingOne),
  play: async ({ canvas, userEvent }) => {
    const chrome = await rowOf(canvas, "Passkeys", "Chrome on macOS");
    await userEvent.click(
      chrome.getByRole("button", {
        name: /^Remove the passkey made in Chrome/,
      }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Remove it" }));
    await waitFor(() =>
      expect(canvas.queryByText("Chrome on macOS")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByText("2 passkeys, newest first.")).toBeVisible();
  },
};

export const TheLastPasskeyIsNotOffered: Story = {
  ...page("/settings/sign-ins", lastPasskey),
  play: async ({ canvas }) => {
    const panel = within(await passkeysPanel(canvas));
    await expect(
      await panel.findByText(
        /It is the hub's only way in, so it cannot be removed/,
      ),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
    await expect(panel.getByText("The only way in")).toBeVisible();
  },
};

export const RemovingAsAnotherBrowserRemovesOne: Story = {
  ...page("/settings/sign-ins", removedElsewhere),
  play: async ({ canvas, userEvent }) => {
    const firefox = await rowOf(canvas, "Passkeys", "Firefox on Windows");
    await userEvent.click(
      firefox.getByRole("button", { name: /^Remove the passkey/ }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Remove it" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      /^Not removed: it is the last way in now/,
    );
  },
};

export const PasskeysForAReaderKey: Story = {
  decorators: [withApi(settings())],
  render: () => <Passkeys owner={false} />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("A reader key cannot see the owner's passkeys."),
    ).toBeVisible();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
