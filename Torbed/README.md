# Torbed

discord doesn't unfurl `.onion` links. this does.

pulls og title/description/image through tor and shows a normal looking embed under the message.

## requirements

- vencord or equicord (desktop)
- tor browser open (uses socks on `127.0.0.1:9150`, tries `9050` if that fails)
- mac/linux for now (uses `curl`)

## install

1. drop this folder into `src/userplugins/torbed`
2. `pnpm build`
3. reinject / restart discord
4. enable **Torbed** in plugins

## notes

- only http(s) onion urls
- preview fetch can take a few seconds
- open still needs tor browser (or anything that handles onions)
