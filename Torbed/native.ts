/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";

const ONION_HOST_RE = /^(?:[a-z0-9-]+\.)*[a-z2-7]{16,56}\.onion$/i;
const MAX_HTML_BYTES = 512_000;
const MAX_IMAGE_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 45_000;
const IS_WIN = process.platform === "win32";
const CURL_BIN = IS_WIN ? "curl.exe" : "curl";


export interface OnionEmbedMeta {
    url: string;
    title: string | null;
    description: string | null;
    siteName: string | null;
    imageDataUrl: string | null;
    error: string | null;
}

function isOnionHttpUrl(raw: string): URL | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!ONION_HOST_RE.test(parsed.hostname)) return null;
    return parsed;
}

function metaContent(html: string, property: string): string | null {
    const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["'][^>]*>`,
        "i"
    );
    const m = html.match(re);
    return m?.[1] || m?.[2] || null;
}

function htmlTitle(html: string): string | null {
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return m?.[1]?.trim() || null;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

function curlViaTor(url: string, socksPort: number, maxBytes: number): Promise<{ ok: boolean; status: number; body: Buffer; contentType: string; error?: string; }> {
    return new Promise(resolve => {
        const args = [
            "-sS",
            "-L",
            "--max-redirs", "3",
            "--max-time", String(Math.ceil(FETCH_TIMEOUT_MS / 1000)),
            "--socks5-hostname", `127.0.0.1:${socksPort}`,
            "-A", "Mozilla/5.0 (compatible; Torbed/1.0)",
            "--compressed",
            "-w", "\n__VC_ONION__%{http_code}|%{content_type}",
            url,
        ];

        const child = spawn(CURL_BIN, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            shell: false,
        });
        const chunks: Buffer[] = [];
        let stderr = "";
        let total = 0;
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            child.kill(IS_WIN ? undefined : "SIGKILL");
        }, FETCH_TIMEOUT_MS + 2000);

        child.stdout.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes + 8_192) {
                killed = true;
                child.kill(IS_WIN ? undefined : "SIGKILL");
                return;
            }
            chunks.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", err => {
            clearTimeout(timer);
            const hint = IS_WIN
                ? "curl.exe missing. Install curl or use a newer Windows 10+."
                : "curl missing from PATH.";
            resolve({
                ok: false,
                status: 0,
                body: Buffer.alloc(0),
                contentType: "",
                error: err.message.includes("ENOENT") ? hint : err.message,
            });
        });
        child.on("close", () => {
            clearTimeout(timer);
            if (killed) {
                resolve({ ok: false, status: 0, body: Buffer.alloc(0), contentType: "", error: "Timed out or response too large." });
                return;
            }

            const raw = Buffer.concat(chunks);
            const marker = Buffer.from("\n__VC_ONION__");
            const idx = raw.lastIndexOf(marker);
            if (idx < 0) {
                resolve({ ok: false, status: 0, body: Buffer.alloc(0), contentType: "", error: stderr.trim() || "Empty response." });
                return;
            }

            const body = raw.subarray(0, Math.min(idx, maxBytes));
            const meta = raw.subarray(idx + marker.length).toString("utf8").trim();
            const [statusText, contentType = ""] = meta.split("|");
            const status = Number(statusText) || 0;

            resolve({
                ok: status >= 200 && status < 400,
                status,
                body,
                contentType: contentType.split(";")[0].trim().toLowerCase(),
                error: status >= 200 && status < 400 ? undefined : (stderr.trim() || `HTTP ${status || "?"}`),
            });
        });
    });
}

async function curlWithPortFallback(url: string, maxBytes: number) {
    const first = await curlViaTor(url, 9150, maxBytes);
    if (first.ok || !(first.error || "").toLowerCase().includes("fail")) return first;
    return curlViaTor(url, 9050, maxBytes);
}

function toDataUrl(buf: Buffer, contentType: string): string | null {
    if (!buf.length) return null;
    const type = contentType.startsWith("image/") ? contentType : "image/png";
    return `data:${type};base64,${buf.toString("base64")}`;
}

export async function fetchOnionEmbed(_: IpcMainInvokeEvent, rawUrl: string): Promise<OnionEmbedMeta> {
    const parsed = isOnionHttpUrl(typeof rawUrl === "string" ? rawUrl : "");
    if (!parsed) {
        return { url: String(rawUrl || ""), title: null, description: null, siteName: null, imageDataUrl: null, error: "Not a valid onion URL." };
    }

    const page = await curlWithPortFallback(parsed.toString(), MAX_HTML_BYTES);
    if (!page.ok) {
        return {
            url: parsed.toString(),
            title: null,
            description: null,
            siteName: null,
            imageDataUrl: null,
            error: page.error || "Could not reach onion site. Is Tor Browser running?",
        };
    }

    const html = page.body.toString("utf8");
    const title = decodeEntities(metaContent(html, "og:title") || metaContent(html, "twitter:title") || htmlTitle(html) || parsed.hostname);
    const description = decodeEntities(metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description") || "");
    const siteName = decodeEntities(metaContent(html, "og:site_name") || "");
    const imageRaw = metaContent(html, "og:image") || metaContent(html, "twitter:image") || "";

    let imageDataUrl: string | null = null;
    if (imageRaw) {
        let imageUrl: URL | null = null;
        try {
            imageUrl = new URL(imageRaw, parsed);
        } catch {
            imageUrl = null;
        }
        if (imageUrl && (imageUrl.protocol === "http:" || imageUrl.protocol === "https:")) {
            const img = await curlWithPortFallback(imageUrl.toString(), MAX_IMAGE_BYTES);
            if (img.ok) imageDataUrl = toDataUrl(img.body, img.contentType);
        }
    }

    return {
        url: parsed.toString(),
        title: title || parsed.hostname,
        description: description || null,
        siteName: siteName || null,
        imageDataUrl,
        error: null,
    };
}
