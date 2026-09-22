[README.md](https://github.com/user-attachments/files/32491505/README.md)
# Torbed

discord doesn't unfurl `.onion` links. this does.

pulls og title/description/image through tor and shows a normal looking embed under the message.

## requirements

- vencord or equicord (**desktop** only, needs native)
- tor browser open (socks `127.0.0.1:9150`, falls back to `9050`)
- `curl` / `curl.exe` on PATH (windows 10+ usually already has it)

## install

1. drop this folder into `src/userplugins/torbed`
2. `pnpm build`
3. reinject / restart discord
4. enable **Torbed** in plugins

## notes

- only http(s) onion urls
- preview fetch can take a few seconds
- open still needs tor browser (or anything that handles onions)
- works on windows, mac, and linux
