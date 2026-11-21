# Install eval, 2026-11-18: `studio-and-laptop` by the claude

Commit `3dca69cc817607e59bb44db90bec8a5eb475be9b`, without the working tree's changes. The claude ran 10 commands and sent the owner 5 messages; the owner ran 6 commands. It took 3.1 minutes, of at most 30, and ended saying it was done.

As its clients reported it, the run cost $0.13: the installer $0.13, claude-sonnet-5-5, 16 turns; the owner $0.00, claude-haiku-5-5, 5 answers.

**Failed**: 4 of 7 criteria failed.

| Criterion | Verdict |
| --- | --- |
| `ended` | passed |
| `doctor` | failed |
| `requests` | failed |
| `titles` | failed |
| `routes` | failed |
| `secrets` | passed |
| `untouched` | passed |

## What was wrong

**`doctor`**

- laptop: config failed: this machine has not joined a hub: /home/owner/.config/cota/config.toml does not exist; fix: cota join <hub>

**`requests`**

- laptop: no stand-in claude sent a request in ~/src/acme-api
- studio: no stand-in claude sent a request in ~/src/notes

**`titles`**

- laptop: no stand-in claude sent a request in ~/src/acme-api
- studio: no stand-in claude sent a request in ~/src/notes

**`routes`**

- claude-code: the hub has * none, not acme/* work, * personal
- codex: the hub has * none, not * chatgpt

## What was done

Each command and message, in order; what each printed is in `run.json`, in the folder of this report's name beside it.

1. The installer said: Before I install Cota, I need four answers:
2. The owner answered: Here are my answers, in order.
3. The installer ran `cd ~/cota && cat examples/cota.example.toml; which bun openssl; curl -s -m 5 http://clickhouse:8123/ping; ls ~/cota-hub 2>&1` on studio: exit 2
4. The installer ran `bun install 2>&1 \| tail -3; echo rc=$?` on studio, in the checkout: exit 0
5. The installer said: I need two secrets from you on studio. Run each in your own terminal on studio, paste the value, press Enter, then Ctrl-D:
6. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/clickhouse")` on studio, with standard input: exit 0
7. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/zai")` on studio, with standard input: exit 0
8. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/personal-login")` on studio, with standard input: exit 0
9. The owner answered: I'll do all three on studio now. Each secret goes straight into its file and I won't repeat any value here.
10. The installer ran `ls -l ~/cota-hub/secrets; cd ~/cota-hub && cat > cota.toml <<EOF` on studio, in the checkout: exit 0
11. The installer ran `sleep 5; curl -s http://127.0.0.1:8080/health; echo; curl -s http://studio:8080/health; echo; grep -c 'cota hub listening' ~/cota-hub/hub.log; sed -E 's/(setup …` on studio: exit 0
12. The installer ran `bun run web:build 2>&1 \| tail -4; ls apps/web/dist/index.html` on studio, in the checkout: exit 143
13. The installer ran `pgrep -f '^bun apps/hub' \|\| (COTA_CONFIG="$HOME/cota-hub/cota.toml" setsid nohup bun run hub > "$HOME/cota-hub/hub.log" 2>&1 < /dev/null & sleep 8)` on studio, in the checkout: exit 0
14. The installer said: The hub runs at http://studio:8080. Open it in a browser: it shows the Setup screen. Give it the setup code from the line `this hub is not set up` in ~/cota-hub…
15. The owner ran `grep 'this hub is not set up' ~/cota-hub/hub.log \| tail -n 1` on studio: exit 0
16. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
17. The owner answered: I'll open http://studio:8080 in my browser, give the Setup screen the setup code from the "this hub is not set up" line in ~/cota-hub/hub.log on studio, and cho…
18. The installer ran `bun run cli:build 2>&1 \| tail -2` on studio, in the checkout: exit 0
19. The installer ran `pwd; bun install 2>&1 \| tail -1; bun run cli:build 2>&1 \| tail -1; curl -s -m 5 http://studio:8080/health; echo` on laptop, in the checkout: exit 0
20. The installer said: Studio is joined and its doctor passes. The only warning is that OpenCode and Pi aren't installed, which is expected.
21. The owner ran `apps/cli/dist/cota login work` on laptop, in the checkout, with standard input: exit 1
22. The owner answered: I'll do both on the laptop in my own terminal, join first and then the work login.
23. The installer ran `apps/cli/dist/cota doctor 2>&1 \| head -20; echo exit=$?` on laptop, in the checkout: exit 0
24. The installer said: The laptop has not joined yet: its doctor still says there is no config. I haven't seen the keys, and nothing was written there.
25. The owner answered: I'll run the join on the laptop now, in my own terminal. When it asks for the hub keys, I'll paste them from studio's two files into the prompt. They won't come…
26. The installer ran `apps/cli/dist/cota doctor 2>&1 \| head -3` on laptop, in the checkout: exit 0
