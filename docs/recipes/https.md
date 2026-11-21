---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-19
supersedes: []
code:
  - deploy/compose.yaml
  - examples/cota.example.toml
---

# HTTPS behind your reverse proxy

A recipe: Cota documents it and never runs it. The reverse proxy, its host name and its certificate are yours.

The hub speaks plain HTTP. To reach it at an `https` address, put the reverse proxy you already run on the hub's machine in front of it: the proxy holds the name and the certificate, and forwards to the hub on loopback. Then hub keys and logins cross the network encrypted, the sign-in cookie is marked `Secure`, and browsers offer passkeys, which they do only at an `https` address with a host name.

## The hub

Keep the install's `COTA_BIND=127.0.0.1` in `.env`, so that only the proxy on this machine reaches the hub. `COTA_PORT` is the port the proxy forwards to; the configurations below take the install's 8080.

## What the proxy must do

- **Stream answers as they come.** A provider's answer streams for minutes; a proxy that buffers it gives the client nothing until it ends.
- **Wait long for the first byte.** The hub waits up to 10 minutes for a provider to begin answering (`[relay] first_byte_timeout`), and a long answer can pause between parts.
- **Take large requests.** A client sends its whole conversation with every request; the hub takes up to 128 MiB (`[relay] max_body_mib`).
- **Pass the request's headers as they are**: `x-cota-key`, `x-cota-project`, `x-cota-machine`, `authorization`, `x-api-key`, `Origin` and `Sec-Fetch-Site`, which the hub reads.
- **Say it was https**, in `X-Forwarded-Proto`, so that the hub marks its sign-in cookie `Secure`.

Nothing of Cota uses a WebSocket.

## Caddy

```caddyfile
cota.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy streams, waits and passes headers as the hub needs without being told, sets `X-Forwarded-Proto`, and gets the certificate itself from a public certificate authority when the name is public and reaches this machine. For a name only your own network knows, add `tls internal` inside the block, and Caddy makes the certificate with a certificate authority of its own, which every browser and program that reaches the hub (`cota` and the clients on each machine) must then trust. Whether `cota` and each client do, with it in a system's trust store, has not been tried.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name cota.example.com;

    ssl_certificate     /etc/letsencrypt/live/cota.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cota.example.com/privkey.pem;

    client_max_body_size 128m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 15m;
        proxy_send_timeout 15m;
    }
}
```

The certificate's paths are where your certificate is (these are certbot's). Each setting is needed: without them nginx refuses a request over 1 MiB with 413, buffers a streamed answer until it ends, cuts a request whose first byte takes over a minute with 504, and leaves the sign-in cookie without `Secure`.

## A proxy that runs in a container

A proxy in a container of its own cannot reach the hub at `127.0.0.1`, which is its own container. Join it to the deployment's network, `cota_default`, and forward to `hub:8080` in place of `127.0.0.1:8080`; in its Compose file:

```yaml
services:
  proxy:
    networks: [cota]
networks:
  cota:
    name: cota_default
    external: true
```

## Then

Join each machine at the `https` address, with no `--allow-plain-http`, and give quota logins with `COTA_HUB_URL` set to it ([`operating.md`](../operating.md#quota-logins)). Open the dashboard there, sign in with the owner password, and make a passkey in Settings → Sign-ins. A passkey belongs to the address it was made at: one made at `http://localhost:8080` does not sign in at `https://cota.example.com`.

## How this was read

Against a deployment brought up as the deployment's slow test does (its Compose file and configuration, a fake provider that streams, the hub image built from this commit), under a Compose project of its own, with each proxy's container sharing the hub's network so that `127.0.0.1:8080` was the hub, as on the hub's machine. Each configuration above was run as printed, Caddy's with `tls internal` and nginx's with a certificate made for the test at certbot's paths. Through each, on 2026-11-19, on macOS with OrbStack:

| | Caddy 2.11.9 | nginx 1.30.7 | nginx without the settings |
| --- | --- | --- | --- |
| A streamed answer, one part a second for 4 seconds | each part as it came | each part as it came | every part at 4 seconds |
| An answer whose first byte took 75 seconds | 200 | 200 | 504 at 60 seconds |
| A request of 2 MiB | 200 | 200 | 413 |
| The sign-in cookie | `Secure` | `Secure` | not `Secure` |
| Passkey options for `Origin: https://cota.example.com` | relying party `cota.example.com` | relying party `cota.example.com` | not tried |

Not run: a certificate from a public authority, a proxy running on the host itself rather than in a container, the joined-network container of the last section as a proxy (the same network was joined by another container, which reached `hub:8080`), and a passkey made in a real browser.
