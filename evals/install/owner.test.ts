import { describe, expect, it } from "@effect/vitest";
import { intentOf, scriptedOwner, whatSessionsShows } from "./owner.ts";
import { tasks } from "./tasks.ts";

const [task] = tasks;
if (task === undefined) throw new Error("no task");

describe("what the scripted owner takes a message to ask", () => {
  it("reads each of the owner's steps from the install prompt's own words", () => {
    const asked = [
      "Before I run anything, please answer these:\n\n1. **Where does the hub run?** One machine…",
      'On studio: please run this in your own terminal, paste the API key of zai, and press Enter and then Ctrl-D:\n\n(umask 077 && cat > "$HOME/cota-hub/secrets/zai")',
      "The hub runs at `http://studio:8080`. Open it in a browser: it shows the Setup screen.",
      'On laptop: please run `~/.local/bin/cota join "http://studio:8080" --allow-plain-http` in your own terminal there.',
      "On laptop: please run `~/.local/bin/cota login work` in your own terminal there.",
      "On studio: please add this line to your crontab: * * * * * '/home/owner/.local/bin/cota' titles report",
      "Please set these routes in the dashboard's Settings → Routes.",
      "Ask the owner to open a new terminal on one machine, start `claude` in a project, and send one message.",
      "Please open the hub's dashboard, Sessions: is your session there?",
      "I am done. studio and laptop are joined.",
      "Please read me your hub key.",
    ];
    expect(asked.map((message) => intentOf(message, task))).toEqual([
      { kind: "questions" },
      { kind: "secret-file", name: "zai" },
      { kind: "setup" },
      {
        kind: "join",
        machine: "laptop",
        command:
          '~/.local/bin/cota join "http://studio:8080" --allow-plain-http',
      },
      { kind: "machine-login", machine: "laptop", pool: "work" },
      {
        kind: "crontab",
        machine: "studio",
        line: "* * * * * '/home/owner/.local/bin/cota' titles report",
      },
      { kind: "routes" },
      { kind: "launch" },
      { kind: "sessions" },
      { kind: "report" },
      { kind: "unknown" },
    ]);
  });

  it("does not run a join, a login or a crontab line on a machine the message does not name", () => {
    expect(
      intentOf(
        "Please run `~/.local/bin/cota login work` in your own terminal.",
        task,
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      intentOf("On desktop: please run `~/.local/bin/cota login work`.", task),
    ).toEqual({
      kind: "unknown",
    });
  });

  it("looks at Sessions after the launches when the message asks for both, as Done's second step does", async () => {
    const owner = scriptedOwner({
      task,
      hands: { act: async (intent) => `did ${intent.kind}` },
    });
    expect(
      await owner.tell(
        "Ask the owner to open a new terminal on one machine, start `claude` in a project, and send one message; then to open the hub's dashboard, Sessions: the session is there.",
      ),
    ).toBe("did launch\ndid sessions");
    expect(
      await owner.tell(
        "Ask the owner to open a new terminal, start `claude` in a project, and send one message.",
      ),
    ).toBe("did launch");
  });
});

describe("what the owner reads on Sessions", () => {
  const session = {
    id: "s1",
    title: null,
    firstPrompt: "Say hello from laptop",
    projects: ["acme/api"],
    machines: ["laptop"],
    pools: ["work"],
  };

  it("says there are none when the hub lists no session", () => {
    expect(
      whatSessionsShows(
        JSON.stringify({ sessions: [], total: 0, limit: 50, offset: 0 }),
      ),
    ).toBe("Sessions shows no sessions.");
  });

  it("names each session by its title, or its first prompt until it has one, with its projects, machines and pools", () => {
    expect(
      whatSessionsShows(
        JSON.stringify({
          sessions: [
            session,
            {
              ...session,
              id: "s2",
              title: { text: "Stand-in: Say hello from studio" },
              firstPrompt: "Say hello from studio",
              projects: ["notes"],
              machines: ["studio"],
              pools: ["personal"],
            },
            { ...session, id: "s3", firstPrompt: null, projects: [] },
          ],
          total: 3,
          limit: 50,
          offset: 0,
        }),
      ),
    ).toBe(
      [
        "Sessions shows 3 sessions:",
        '- no title yet, first prompt "Say hello from laptop": project acme/api, machine laptop, pool work',
        '- titled "Stand-in: Say hello from studio": project notes, machine studio, pool personal',
        "- no title or first prompt yet: project none, machine laptop, pool work",
      ].join("\n"),
    );
  });
});
