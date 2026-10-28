import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { updateMessage } from "@api/MessageUpdater";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Menu, MessageStore, SelectedChannelStore, showToast } from "@webpack/common";

import { decryptText, encryptText, looksEncrypted } from "./crypto";

const settings = definePluginSettings({
    encryptOutgoing: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Encrypt outgoing messages while the composer button is enabled"
    },
    decryptIncoming: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Automatically decrypt received Aegires text messages in the local message view",
        onChange(value) {
            if (value) decryptCurrentChannel();
        }
    },
    passphrase: {
        type: OptionType.STRING,
        default: "",
        description: "Shared passphrase. Every participant must use the same passphrase.",
        onChange() {
            recentlyTried.clear();
            decryptCurrentChannel();
        }
    }
});

// Keep each original cipher string for the context menu's local restore action.
const ciphertextByMessageId = new Map<string, string>();
const recentlyTried = new Map<string, string>();
const MAX_REMEMBERED_MESSAGES = 500;

function LockIcon({ open = false, width = 20, height = 20, className }: { open?: boolean; width?: number | string; height?: number | string; className?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            {open
                ? <path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-9.9-1h2.1A3 3 0 0 1 15 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Zm-5 9.73V19h-2v-1.27a2 2 0 1 1 2 0Z" />
                : <path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2ZM9 6a3 3 0 0 1 6 0v2H9Zm4 11.73V19h-2v-1.27a2 2 0 1 1 2 0Z" />}
        </svg>
    );
}

const EncryptionToggle: ChatBarButtonFactory = ({ isMainChat }) => {
    const { encryptOutgoing: enabled } = settings.use(["encryptOutgoing"]);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={enabled ? "Disable Aegires message encryption" : "Enable Aegires message encryption"}
            onClick={() => settings.store.encryptOutgoing = !enabled}
            buttonProps={{ "aria-pressed": enabled, style: { color: enabled ? "var(--status-positive)" : undefined } }}
        >
            <LockIcon open={!enabled} />
        </ChatBarButton>
    );
};

function MessageEncryptionIndicator({ message }: { message: Message; }) {
    if (!message.content) return null;
    const encrypted = looksEncrypted(message.content) || ciphertextByMessageId.has(message.id);

    return (
        <span className={`aegires-e2ee-indicator${encrypted ? " aegires-e2ee-indicator--encrypted" : ""}`} title={encrypted ? "Aegires-encrypted message" : "Message is not encrypted with Aegires"} aria-label={encrypted ? "Aegires-encrypted message" : "Message is not encrypted with Aegires"}>
            <LockIcon open={!encrypted} width={14} height={14} />
        </span>
    );
}

function remember(map: Map<string, string>, id: string, value: string) {
    map.delete(id);
    map.set(id, value);
    if (map.size > MAX_REMEMBERED_MESSAGES) map.delete(map.keys().next().value!);
}

async function encryptMessage(message: { content: string; }, force = false) {
    if ((!settings.store.encryptOutgoing && !force) || !message.content || looksEncrypted(message.content)) return;
    const passphrase = settings.store.passphrase;
    if (!passphrase) {
        showToast({ text: "Aegires E2EE is enabled, but no passphrase is set. Message was not sent.", variant: "critical" });
        return { cancel: true };
    }

    try {
        const encrypted = await encryptText(message.content, passphrase);
        // Fail closed: never send plaintext on an enabled encryption failure.
        if (encrypted.length > 2000) {
            showToast({ text: "Encrypted message exceeds Discord's 2000-character limit. Message was not sent.", variant: "critical" });
            return { cancel: true };
        }
        message.content = encrypted;
    } catch {
        showToast({ text: "Aegires E2EE encryption failed. Message was not sent.", variant: "critical" });
        return { cancel: true };
    }
}

async function decryptMessage(message: Message, force = false) {
    const passphrase = settings.store.passphrase;
    if ((!settings.store.decryptIncoming && !force) || !passphrase || !message?.content || !looksEncrypted(message.content)) return;
    if (!force && recentlyTried.get(message.id) === message.content) {
        const cachedMessage = MessageStore.getMessage(message.channel_id, message.id);
        if (cachedMessage?.content !== message.content) return;
    }

    const ciphertext = message.content;
    const plaintext = await decryptText(ciphertext, passphrase);
    if (plaintext === null) {
        remember(recentlyTried, message.id, ciphertext);
        return;
    }

    remember(ciphertextByMessageId, message.id, ciphertext);
    remember(recentlyTried, message.id, ciphertext);
    updateMessage(message.channel_id, message.id, { content: plaintext });
}

function queueDecrypt(message?: Message) {
    if (!message?.id || !message.channel_id || !message.content) return;
    // Run after Discord's dispatcher has inserted/updated the message cache entry.
    setTimeout(() => void decryptMessage(message), 0);
}

function decryptCurrentChannel() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;
    const collection = MessageStore.getMessages(channelId) as { _array?: Message[] } | undefined;
    for (const message of collection?._array ?? []) queueDecrypt(message);
}

const messageContextMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message?.content) return;
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    const copyTextIndex = group.findIndex(child => child?.props?.id === "copy-text");
    if (copyTextIndex < 0) return;

    const restoreCiphertext = ciphertextByMessageId.get(message.id);
    const action = looksEncrypted(message.content)
        ? (
            <Menu.MenuItem
                id="aegires-e2ee-decrypt"
                label="Decrypt with Aegires E2EE"
                action={() => void decryptMessage(message, true)}
            />
        )
        : restoreCiphertext
            ? (
                <Menu.MenuItem
                    id="aegires-e2ee-restore"
                    label="Show encrypted text"
                    action={() => updateMessage(message.channel_id, message.id, { content: restoreCiphertext })}
                />
            )
            : null;

    if (action) group.splice(copyTextIndex + 1, 0, action);
};

export default definePlugin({
    name: "AegiresE2EE",
    description: "AES-GCM text encryption compatible with Aegires, with local message decryption",
    tags: ["Privacy", "Chat"],
    authors: [{ name: "Jhon444 (@ojhon444)", id: 0n, badge: false }],
    settings,

    chatBarButton: {
        icon: LockIcon,
        render: EncryptionToggle
    },

    renderMessageDecoration: ({ message }) => <MessageEncryptionIndicator message={message} />,

    contextMenus: {
        message: messageContextMenu
    },

    start() {
        settings.store.encryptOutgoing = false;
        recentlyTried.clear();
        ciphertextByMessageId.clear();
        decryptCurrentChannel();
    },

    stop() {
        settings.store.encryptOutgoing = false;
        recentlyTried.clear();
        ciphertextByMessageId.clear();
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic?: boolean; }) {
            if (!optimistic) queueDecrypt(message);
        },
        MESSAGE_UPDATE({ message }: { message: Message; }) {
            queueDecrypt(message);
        },
        LOAD_MESSAGES_SUCCESS({ messages }: { messages?: Message[]; }) {
            for (const message of messages ?? []) queueDecrypt(message);
        }
    },

    async onBeforeMessageSend(_channelId, message) {
        return encryptMessage(message);
    },

    async onBeforeMessageEdit(channelId, messageId, message) {
        const original = MessageStore.getMessage(channelId, messageId);
        const wasEncrypted = looksEncrypted(original?.content ?? "") || ciphertextByMessageId.has(messageId);
        return encryptMessage(message, wasEncrypted);
    }
});
