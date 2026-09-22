/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { TextButton } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { MaskedLink, useEffect, useState } from "@webpack/common";

import type { OnionEmbedMeta } from "./native";

migratePluginSettings("Torbed", "OnionEmbeds");

const Native = VencordNative.pluginHelpers.Torbed as PluginNative<typeof import("./native")>;

const cl = classNameFactory("vc-torbed-");
const SETTINGS_KEYS = ["maxPerMessage"] as const;

const ONION_URL_RE =
    /https?:\/\/(?:[a-z0-9-]+\.)*[a-z2-7]{16,56}\.onion(?::\d{1,5})?(?:\/[^\s<>"'`\]\)]*)?/gi;

const metaCache = new Map<string, OnionEmbedMeta | "loading" | "error">();
const waiters = new Map<string, Array<(meta: OnionEmbedMeta | null) => void>>();

const settings = definePluginSettings({
    maxPerMessage: {
        type: OptionType.SLIDER,
        description: "Max onion embeds to show under one message.",
        markers: [1, 2, 3, 5, 8],
        default: 3,
        stickToMarkers: true,
    },
});

function extractOnionUrls(content: string | undefined): string[] {
    if (!content) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const match of content.matchAll(ONION_URL_RE)) {
        const url = match[0].replace(/[),.;!?]+$/g, "");
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

async function loadMeta(url: string): Promise<OnionEmbedMeta | null> {
    const cached = metaCache.get(url);
    if (cached && cached !== "loading" && cached !== "error") return cached;

    if (cached === "loading") {
        return new Promise(resolve => {
            const list = waiters.get(url) ?? [];
            list.push(resolve);
            waiters.set(url, list);
        });
    }

    metaCache.set(url, "loading");
    try {
        const meta = await Native.fetchOnionEmbed(url);
        if (meta.error && !meta.title) {
            metaCache.set(url, "error");
            waiters.get(url)?.forEach(cb => cb(null));
            waiters.delete(url);
            return null;
        }
        metaCache.set(url, meta);
        waiters.get(url)?.forEach(cb => cb(meta));
        waiters.delete(url);
        return meta;
    } catch {
        metaCache.set(url, "error");
        waiters.get(url)?.forEach(cb => cb(null));
        waiters.delete(url);
        return null;
    }
}

interface TorbedCardProps {
    url: string;
}

function TorbedCard({ url }: TorbedCardProps) {
    const [meta, setMeta] = useState<OnionEmbedMeta | null>(() => {
        const cached = metaCache.get(url);
        return cached && cached !== "loading" && cached !== "error" ? cached : null;
    });
    const [loading, setLoading] = useState(!meta);
    const [failed, setFailed] = useState(metaCache.get(url) === "error");

    useEffect(() => {
        let alive = true;
        const cached = metaCache.get(url);
        if (cached && cached !== "loading" && cached !== "error") {
            setMeta(cached);
            setLoading(false);
            setFailed(false);
            return;
        }
        setLoading(true);
        loadMeta(url).then(result => {
            if (!alive) return;
            setLoading(false);
            if (!result) {
                setFailed(true);
                return;
            }
            setMeta(result);
            setFailed(false);
        });
        return () => {
            alive = false;
        };
    }, [url]);

    const host = hostnameOf(url);
    const title = meta?.title || host;
    const description = meta?.description;
    const siteName = meta?.siteName || "Torbed";

    return (
        <div className={cl("embed")}>
            <div className={cl("pill")} />
            <div className={cl("inner")}>
                <div className={cl("provider")}>{loading ? "Loading Torbed preview…" : siteName}</div>
                <MaskedLink href={url} className={cl("title")}>
                    {title}
                </MaskedLink>
                {description ? <div className={cl("desc")}>{description}</div> : null}
                {meta?.imageDataUrl ? (
                    <img className={cl("image")} src={meta.imageDataUrl} alt="" />
                ) : null}
                {failed ? (
                    <div className={cl("note")}>Could not fetch preview. Is Tor Browser open?</div>
                ) : null}
                <div className={cl("actions")}>
                    <TextButton variant="link" onClick={() => copyWithToast(url, "Copied onion link.")}>
                        Copy
                    </TextButton>
                    <TextButton variant="link" onClick={() => VencordNative.native.openExternal(url)}>
                        Open
                    </TextButton>
                </div>
            </div>
        </div>
    );
}

function TorbedAccessory({ message }: { message: Message; }) {
    const { maxPerMessage } = settings.use(SETTINGS_KEYS);
    const urls = extractOnionUrls(message.content).slice(0, maxPerMessage);
    if (!urls.length) return null;

    return (
        <div className={cl("wrap")}>
            {urls.map(url => (
                <TorbedCard key={url} url={url} />
            ))}
        </div>
    );
}

const Accessory = ErrorBoundary.wrap(TorbedAccessory, { noop: true });

export default definePlugin({
    name: "Torbed",
    description: "Shows real Open Graph embeds for .onion links by fetching through Tor.",
    authors: [{ name: "c00lkiddtech", id: 0n }],
    settings,
    dependencies: ["MessageAccessoriesAPI"],

    renderMessageAccessory: props => <Accessory message={props.message} />,
});
