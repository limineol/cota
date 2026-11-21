# Product

## Platform

A self-hosted server (the hub), a command-line client for each machine, and a web dashboard.

## Users

People who use AI coding tools seriously enough to hold more than one subscription or work on more than one machine: a personal Claude plan and a client's, a ChatGPT plan for Codex, an API coding plan or two, a local model server. They are developers. They will run a container and edit a config file, and they expect the result to stay out of their way.

Cota began as one such person's private hub. The public version is for anyone in that position, so nothing in it assumes that person's machines, pools or network.

## Product Purpose

One hub between every coding client and every provider. Because all traffic passes through it, the hub can do four things no single client can:

- **Bill the right pool.** A project's requests go to the pool its route names, on any machine.
- **Keep working at a limit.** When a provider refuses a login, its requests are diverted to a fallback pool until the limit resets, and the session carries on.
- **Show every quota window in one place.** How much of each window is used, whether usage is on pace, and when it resets, across every pool.
- **Remember everything.** Every request and conversation is kept in a request log the owner and their agents can search and query with SQL.

Success: the owner knows at a glance which pools are close to a limit, never loses a working session to one, and can find any past conversation in seconds.

## Positioning

A provider's usage page covers one account. A client's usage view covers one client. Subscription proxies that hold your logins and translate between protocols let any tool spend any subscription, which is exactly what the providers' terms do not allow.

Cota forwards each client's own login to that client's own provider. It does not pool, resell or convert logins, and a hub key alone cannot spend a subscription. What it adds is the view across all of them, the request log, and the fallback between pools the same owner holds.

## Product Principles

1. **The request log is the truth.** Every number on the dashboard traces back to requests in the request log. A percentage is never invented.
2. **The login stays with the client.** The hub keeps only the logins the owner hands it on purpose, and uses each for one stated job.
3. **Promises are proved or tested, and the docs say which.** Where Cota decides who pays, the decision is a small program with stated laws.
4. **An agent can set it up.** Installation is a prompt the owner pastes into their coding agent, and a `doctor` command says whether it worked.
5. **Glanceable now, deep later.** The first screen answers "which pools are hot". Sessions, transcripts and SQL are one step further.

## Voice

Plain and factual. Say what happened and what to do next. No slogans, exclamation marks or marketing claims inside the product. One word for one concept, taken from `CONTEXT.md`.
