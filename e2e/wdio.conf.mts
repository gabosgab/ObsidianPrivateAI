import * as path from "path";
import { fileURLToPath } from "url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(e2eDir, "..");

export const config: WebdriverIO.Config = {
    runner: "local",
    framework: "mocha",
    specs: ["./specs/**/*.e2e.ts"],
    maxInstances: 1,

    capabilities: [
        {
            browserName: "obsidian",
            browserVersion: "latest",
            "wdio:obsidianOptions": {
                installerVersion: "latest",
                plugins: [rootDir],
                vault: path.join(e2eDir, "vault"),
            },
        },
    ],

    services: ["obsidian"],
    reporters: ["obsidian"],
    cacheDir: path.join(rootDir, ".obsidian-cache"),
    mochaOpts: {
        ui: "bdd",
        timeout: 120000,
    },
    logLevel: "warn",
};
