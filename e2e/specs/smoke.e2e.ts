import { browser, expect } from "@wdio/globals";

describe("Private AI plugin in real Obsidian (spike)", function () {
    it("loads the plugin", async function () {
        const loaded = await browser.executeObsidian(({ app }) => {
            return !!(app as any).plugins.plugins["private-ai"];
        });
        expect(loaded).toBe(true);
    });

    it("reads a note from the test vault", async function () {
        const content = await browser.executeObsidian(async ({ app }) => {
            const file = app.vault.getFileByPath("Home/Water Heater Replacement.md");
            return file ? await app.vault.read(file) : null;
        });
        expect(content).toContain("2024-03-15");
        expect(content).toContain("$1,850");
    });

    it("opens the chat view via the plugin command", async function () {
        await browser.executeObsidianCommand("private-ai:open-local-llm-chat");
        const view = browser.$('[data-type="local-llm-chat-view"]');
        await expect(view).toExist();
    });

    it("performs vault CRUD like agent tools will (create, rename, read back)", async function () {
        await browser.executeObsidian(async ({ app }) => {
            const existing = app.vault.getFileByPath("Spike Test.md");
            if (existing) await app.vault.delete(existing);
            await app.vault.create("Spike Test.md", "hello from wdio");
            const f = app.vault.getFileByPath("Spike Test.md");
            if (!f) throw new Error("create failed");
            await app.fileManager.renameFile(f, "Spike Test Renamed.md");
        });
        const renamed = await browser.executeObsidian(async ({ app }) => {
            const f = app.vault.getFileByPath("Spike Test Renamed.md");
            return f ? await app.vault.read(f) : null;
        });
        expect(renamed).toBe("hello from wdio");
    });
});
