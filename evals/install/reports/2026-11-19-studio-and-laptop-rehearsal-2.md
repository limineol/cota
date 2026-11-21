# Install eval, 2026-11-19: `studio-and-laptop` by the rehearsal

Commit `3f0d2ebcb295277ccb514d9ff93167353f3ed018`, without the working tree's changes. The rehearsal ran 17 commands and sent the owner 11 messages; the owner ran 16 commands. It took 2.0 minutes, of at most 30, and ended saying it was done.

**Passed**: every criterion passed.

| Criterion | Verdict |
| --- | --- |
| `ended` | passed |
| `doctor` | passed |
| `requests` | passed |
| `titles` | passed |
| `routes` | passed |
| `secrets` | passed |
| `untouched` | passed |

## What was done

Each command and message, in order; what each printed is in `run.json`, in the folder of this report's name beside it.

1. The installer said: Before I run anything, please answer these:
2. The owner answered: 1. The hub runs on studio, the machine you are on; it stays on, and every machine reaches it. It has Docker, Git and Bun, and Cota's checkout in ~/cota; you may…
3. The installer ran `docker build --build-arg COTA_REVISION="$(git rev-parse HEAD)" -t "cota-hub:$(git rev-parse --short=12 HEAD)" .` on studio, in the checkout: exit 0
4. The installer ran `mkdir -p "$HOME/cota-hub" && chmod 700 "$HOME/cota-hub"` on studio, in the checkout: exit 0
5. The installer ran `for name in clickhouse clients fleet agents; do (umask 077 && openssl rand -hex 24 > "$HOME/cota-hub/secrets/$name"); done` on studio, in the checkout: exit 0
6. The installer said: On studio: please run this in your own terminal, paste what claude setup-token prints, signed in to personal, and press Enter and then Ctrl-D:
7. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/personal-login")` on studio, with standard input: exit 0
8. The owner answered: Done: I pasted it.
9. The installer said: On studio: please run this in your own terminal, paste the API key of zai, and press Enter and then Ctrl-D:
10. The owner ran `(umask 077 && cat > "$HOME/cota-hub/secrets/zai")` on studio, with standard input: exit 0
11. The owner answered: Done: I pasted it.
12. The installer ran `(umask 077 && cat > "$HOME/cota-hub/.env" <<EOF` on studio, in the checkout: exit 0
13. The installer ran `(umask 077 && cp deploy/cota.toml "$HOME/cota-hub/cota.toml")` on studio, in the checkout: exit 0
14. The installer ran `cat >> "$HOME/cota-hub/cota.toml" <<'EOF'` on studio, in the checkout: exit 0
15. The installer ran `cd "$HOME/cota-hub" && docker compose up -d --wait` on studio, in the checkout: exit 0
16. The installer ran `HUB=http://studio:8080` on studio, in the checkout: exit 0
17. The installer said: The hub runs at `http://studio:8080`. Open it in a browser: it shows the Setup screen. Give it the setup code from the line `this hub is not set up` that `docke…
18. The owner ran `cd ~/cota-hub && docker compose logs hub \| grep 'this hub is not set up' \| tail -n 1` on studio: exit 0
19. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
20. The owner answered: I am signed in.
21. The installer ran `bun install` on studio, in the checkout: exit 0
22. The installer ran `HUB=http://studio:8080` on studio, in the checkout: exit 0
23. The installer said: On studio: this system has no scheduler cota can use, so the title reporter is not scheduled. Please add this line to your crontab (crontab -e), which is yours:…
24. The owner ran `{ crontab -l 2>/dev/null; cat; } \| crontab -` on studio, with standard input: exit 0
25. The owner answered: Done. It printed:
26. The installer ran `apps/cli/dist/cota doctor` on studio, in the checkout: exit 0
27. The installer ran `bun install` on laptop, in the checkout: exit 0
28. The installer said: On laptop: it does not reach studio by ssh, so please run `apps/cli/dist/cota join "http://studio:8080" --allow-plain-http` in your own terminal there, in its c…
29. The owner ran `cat ~/cota-hub/secrets/clients ~/cota-hub/secrets/fleet` on studio: exit 0
30. The owner ran `apps/cli/dist/cota join "http://studio:8080" --allow-plain-http` on laptop, in the checkout, with standard input: exit 0
31. The owner answered: Done. It printed:
32. The installer said: On laptop: this system has no scheduler cota can use, so the title reporter is not scheduled. Please add this line to your crontab (crontab -e), which is yours:…
33. The owner ran `{ crontab -l 2>/dev/null; cat; } \| crontab -` on laptop, with standard input: exit 0
34. The owner answered: Done. It printed:
35. The installer ran `apps/cli/dist/cota doctor` on laptop, in the checkout: exit 0
36. The installer said: On laptop: a route sends acme's projects to work, a subscription Claude Code there is not signed in to. Please run `apps/cli/dist/cota login work` in your own t…
37. The owner ran `apps/cli/dist/cota login work` on laptop, in the checkout, with standard input: exit 0
38. The owner answered: Done. It printed:
39. The installer said: Please set these routes in the dashboard's Settings → Routes, which needs the owner password:
40. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
41. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
42. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
43. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
44. The owner ran `mkdir -p /tmp/owner-browser && curl -s -w '\n%{http_code}' --config -` on studio, with standard input: exit 0
45. The owner answered: I set them in Settings → Routes.
46. The installer ran `COTA="$PWD/apps/cli/dist/cota"` on studio, in the checkout: exit 0
47. The installer ran `COTA="$PWD/apps/cli/dist/cota"` on laptop, in the checkout: exit 0
48. The installer said: A request made through a launched client appears in the dashboard. Ask the owner to open a new terminal on one machine, start `claude` (or `codex`) in a project…
49. The owner ran `bash -lic 'cd ~/src/acme-api && claude -p "Say hello from laptop"'` on laptop: exit 0
50. The owner ran `bash -lic 'cd ~/src/notes && claude -p "Say hello from studio"'` on studio: exit 0
51. The owner answered: On laptop, in ~/src/acme-api: Done. It printed:
52. The installer ran `apps/cli/dist/cota doctor` on studio, in the checkout: exit 0
53. The installer ran `apps/cli/dist/cota doctor` on laptop, in the checkout: exit 0
54. The installer said: I am done. studio and laptop are joined to the hub at http://studio:8080, and doctor passes on each. You set the hub up, typed every key and login, and set the …
55. The owner answered: Thank you.
