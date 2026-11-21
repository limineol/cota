# Install eval, 2026-11-19: `studio-and-laptop` by the claude

Commit `e478792e0dde34d5f1be3e9b565b7f504abeb7a6`. The claude ran 10 commands and sent the owner 5 messages; the owner ran 16 commands. It took 2.8 minutes, of at most 30, and ended its turn without saying it was done: "Only the dashboard check is left.".

As its clients reported it, the run cost $0.16: the installer $0.16, claude-sonnet-5-5, 16 turns; the owner $0.00, claude-haiku-5-5, 5 answers.

**Failed**: 2 of 7 criteria failed.

| Criterion | Verdict |
| --- | --- |
| `ended` | failed |
| `doctor` | passed |
| `requests` | passed |
| `titles` | failed |
| `routes` | passed |
| `secrets` | passed |
| `untouched` | passed |

## What was wrong

**`ended`**

- the installer ended its turn without saying it was done: "Only the dashboard check is left."

**`titles`**

- the installer ran cota titles report after the launches, so a title may not have come from the schedule

## What was done

Each command and message, in order; what each printed is in `run.json`, in the folder of this report's name beside it.

1. The installer said: Before I install Cota, I need four answers.
2. The owner answered: Here are my answers.
3. The installer ran `cd ~/cota && git rev-parse HEAD && docker build --build-arg COTA_REVISION="$(git rev-parse HEAD)" -t "cota-hub:$(git rev-parse --short=12 HEAD)" . 2>&1 \| tail -…` on studio: exit 0
4. The installer ran `cd ~/cota && mkdir -p "$HOME/cota-hub" && chmod 700 "$HOME/cota-hub"` on studio: exit 0
5. The installer said: The hub image is built and its configuration is written. I need two secret files from you, in your own terminal on studio. I never see either one. For each, run…
6. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/zai")` on studio, with standard input: exit 0
7. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/personal-login")` on studio, with standard input: exit 0
8. The owner answered: Both are done. I ran claude setup-token signed in to personal (Pro), then wrote the Z.ai key to $HOME/cota-hub/secrets/zai and personal's kept login to $HOME/co…
9. The installer ran `cd ~/cota-hub && ls -l secrets \| awk '{print $1,$5,$9}'; docker compose up -d --wait 2>&1 \| tail -8; curl -s http://studio:8080/health; echo; docker compose log…` on studio: exit 0
10. The installer said: The hub runs at http://studio:8080. Open it in a browser and it shows the Setup screen. Give it the setup code from the line `this hub is not set up` that `dock…
11. The owner ran `cd ~/cota-hub && docker compose logs hub \| grep 'this hub is not set up' \| tail -n 1` on studio: exit 0
12. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
13. The owner answered: Done. I opened http://studio:8080, gave the Setup screen the setup code from the hub's log, and chose the owner password myself. I am signed in to the dashboard…
14. The installer ran `cd ~/cota && bun install 2>&1 \| tail -2 && bun run cli:build 2>&1 \| tail -2 && cat "$HOME/cota-hub/secrets/clients" "$HOME/cota-hub/secrets/fleet" \| apps/cli/di…` on studio: exit 0
15. The installer ran `cd ~/cota && curl -s http://studio:8080/health; echo; ssh -o BatchMode=yes studio 'test -r cota-hub/secrets/clients && echo ssh-ok' 2>&1 \| tail -2` on laptop: exit 0
16. The installer ran `cd ~/cota && bun install 2>&1 \| tail -1 && bun run cli:build 2>&1 \| tail -1; pwd` on laptop: exit 0
17. The installer said: Studio is joined, and doctor passes there. Its only warning is that OpenCode and Pi aren't installed. The title reporter isn't scheduled on studio, because it h…
18. The owner ran `cat ~/cota-hub/secrets/clients ~/cota-hub/secrets/fleet` on studio: exit 0
19. The owner ran `apps/cli/dist/cota join http://studio:8080 --allow-plain-http` on laptop, in the checkout, with standard input: exit 0
20. The owner ran `apps/cli/dist/cota login work` on laptop, in the checkout, with standard input: exit 0
21. The owner ran `{ crontab -l 2>/dev/null; cat; } \| crontab -` on studio, with standard input: exit 0
22. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
23. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
24. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
25. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
26. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
27. The owner answered: Done. I ran the join on laptop and pasted the clients and fleet keys into its prompt myself, so they never came through here. I ran claude setup-token signed in…
28. The installer ran `cd ~/cota && apps/cli/dist/cota doctor; echo exit=$?; crontab -l 2>&1 \| grep -c 'titles report'; mkdir -p /tmp/rt/acme/x && cd /tmp/rt/acme/x && ~/cota/apps/cli…` on laptop: exit 0
29. The installer ran `cd ~/cota && apps/cli/dist/cota doctor \| grep -v '^passed'; echo exit=${PIPESTATUS[0]}; crontab -l 2>&1 \| grep -c 'titles report'` on studio: exit 0
30. The installer said: Doctor exits 0 on both machines, with no `failed` line. Two things are left.
31. The owner ran `{ crontab -l 2>/dev/null; cat; } \| crontab -` on laptop, with standard input: exit 0
32. The owner ran `bash -lic 'cd ~/src/acme-api && claude -p "Say hello from laptop"'` on laptop: exit 0
33. The owner ran `bash -lic 'cd ~/src/notes && claude -p "Say hello from studio"'` on studio: exit 0
34. The owner answered: Done: I added the titles line to the laptop's crontab, exactly as you wrote it. I also opened a new terminal, started claude in a project and sent one message, …
35. The installer ran `cd ~/src/acme-api && ~/cota/apps/cli/dist/cota route; crontab -l \| grep -c 'titles report'` on laptop: exit 0
36. The installer ran `cd ~/cota-hub && docker compose exec -T clickhouse sh -c 'clickhouse-client --user cota --password "$(cat /etc/cota/secrets/clickhouse 2>/dev/null)" -q "select …` on studio: exit 0
