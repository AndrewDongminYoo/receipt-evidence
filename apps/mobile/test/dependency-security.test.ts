import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const mobile = createRequire(new URL("../package.json", import.meta.url));
const expo = createRequire(mobile.resolve("expo/package.json"));
/** Resolve each parent's own graph so hoisting cannot mask a vulnerable dependency. */
const consumer = (name: string) => createRequire(expo.resolve(`${name}/package.json`));
const cli = consumer("@expo/cli");
const root = new URL("../../../", import.meta.url);
const contract = createRequire(new URL("packages/contract/package.json", root));

/** Give file-consuming Expo helpers a disposable project without prebuilding this app. */
async function fixture(t: test.TestContext, files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "receipt-dependencies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const destination = join(directory, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return directory;
}

/** Reject file formats that hide the application graph behind pnpm bootstrap data. */
function readGraph(source: string) {
  const documents = cli("yaml").parseAllDocuments(source);
  assert.equal(documents.length, 1, "dependency scanners need one YAML document");
  assert.deepEqual(documents[0].errors, []);
  const graph = documents[0].toJSON();
  assert.ok(graph.importers?.["apps/mobile"]?.dependencies?.expo, "mobile dependencies missing");
  assert.ok(graph.packages && graph.snapshots, "resolved package graph missing");
  return graph as {
    importers: Record<
      string,
      Partial<Record<"dependencies" | "devDependencies" | "optionalDependencies", Record<string, { version: string }>>>
    >;
    packages: Record<string, unknown>;
    snapshots: Record<string, { dependencies?: Record<string, string> }>;
  };
}

test("the scanner reader rejects an env-only lockfile", () => {
  const boot =
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    packageManagerDependencies: {}\npackages: {}\nsnapshots: {}\n";
  assert.throws(() => readGraph(boot), /mobile dependencies missing/);
  assert.throws(
    () => readGraph(`${boot}---\nlockfileVersion: '9.0'\nimporters: {}\npackages: {}\nsnapshots: {}\n`),
    /dependency scanners need one YAML document/,
  );
});

/** Enforce patched matchers and Zod throughout the installed workspace graph. */
function assertGraphSecurity(graph: ReturnType<typeof readGraph>) {
  for (const key of Object.keys(graph.packages)) {
    const match = /^(zod|glob|minimatch)@(\d+)\.(\d+)\.(\d+)$/.exec(key);
    if (!match) continue;
    const [, name, major, minor, patch] = match;
    const version = [Number(major), Number(minor), Number(patch)];
    const minimum = name === "zod" ? [4, 6, 6] : name === "glob" ? [14, 0, 2] : [11, 0, 1];
    assert.ok(
      version[0] > minimum[0] ||
        (version[0] === minimum[0] &&
          (version[1] > minimum[1] || (version[1] === minimum[1] && version[2] >= minimum[2]))),
      `${key} is below the advisory's patched line`,
    );
  }
  for (const [name, importer] of Object.entries(graph.importers)) {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      for (const [dependency, { version }] of Object.entries(importer[section] ?? {})) {
        const legacyZod = (dependency === "zod" && /^3(?:\.|$)/.test(version)) || /^zod@3(?:\.|$)/.test(version);
        assert.equal(legacyZod, false, `workspace importers must not consume Zod 3: ${name}.${section}.${dependency}`);
      }
    }
  }
}

test("the graph fixes matchers and contains no legacy Zod", async () => {
  assertGraphSecurity(readGraph(await readFile(new URL("pnpm-lock.yaml", root), "utf8")));
});

for (const dependency of ["glob@13.0.7", "minimatch@10.2.6", "zod@3.25.76"]) {
  test(`the graph rejects ${dependency}`, async () => {
    const graph = readGraph(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
    graph.packages[dependency] = {};
    assert.throws(() => assertGraphSecurity(graph), {
      message: `${dependency} is below the advisory's patched line`,
    });
  });
}

for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
  for (const alias of [false, true]) {
    test(`the graph rejects a workspace ${section} ${alias ? "alias to" : "direct dependency on"} Zod 3`, async () => {
      const graph = readGraph(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
      graph.importers["apps/mobile"][section] = {
        ...graph.importers["apps/mobile"][section],
        [alias ? "legacy-validator" : "zod"]: { version: alias ? "zod@3.25.76" : "3.25.76" },
      };
      assert.throws(() => assertGraphSecurity(graph), /workspace importers must not consume Zod 3/);
    });
  }
}

test("Expo resolves patched matchers and the contract retains patched Zod", () => {
  for (const name of ["@expo/cli", "@expo/config", "@expo/config-plugins", "@expo/metro-config", "@expo/fingerprint"]) {
    const loader = consumer(name);
    const [globMajor, globMinor, globPatch] = loader("glob/package.json").version.split(".").map(Number);
    assert.ok(globMajor === 14 && (globMinor > 0 || globPatch >= 2), `${name} needs glob >=14.0.2 within major 14`);
    const glob = createRequire(loader.resolve("glob/package.json"));
    const [major, minor, patch] = glob("minimatch/package.json").version.split(".").map(Number);
    assert.ok(major === 11 && (minor > 0 || patch >= 1), "glob needs minimatch >=11.0.1 within major 11");
  }
  assert.equal(contract("zod/package.json").version, "4.6.6");
  const [major, minor, patch] = consumer("@expo/fingerprint")("minimatch/package.json").version.split(".").map(Number);
  assert.ok(major === 11 && (minor > 0 || patch >= 1), "fingerprint needs minimatch >=11.0.1 within major 11");
});

test("Expo config and plugins still discover native project files", async (t) => {
  const directory = await fixture(t, {
    "package.json": '{"name":"fixture","version":"1.0.0"}',
    "app.json": '{"expo":{"name":"Receipt","slug":"receipt"}}',
    "android/app/build.gradle": "// fixture",
    "android/app/src/main/java/example/MainApplication.kt": "class MainApplication",
    "ios/Receipt/AppDelegate.swift": "// fixture",
    "ios/Receipt.xcodeproj/project.pbxproj": "// fixture",
  });
  const config = consumer("@expo/config")("./build/Config.js");
  assert.equal(config.getConfig(directory, { skipSDKVersionRequirement: true }).exp.name, "Receipt");
  assert.equal(config.getDefaultTarget(directory), "bare");
  const plugins = consumer("@expo/config-plugins");
  assert.equal(
    plugins("./build/android/Paths.js").getProjectFilePath(directory, "MainApplication"),
    join(directory, "android/app/src/main/java/example/MainApplication.kt"),
  );
  assert.equal(
    plugins("./build/ios/Paths.js").getAppDelegateFilePath(directory),
    join(directory, "ios/Receipt/AppDelegate.swift"),
  );
});

test("Metro workspace discovery excludes native vendors and malformed manifests", async (t) => {
  const directory = await fixture(t, {
    "package.json": '{"private":true,"workspaces":["packages/**"]}',
    "packages/shared/package.json": '{"name":"shared"}',
    "packages/broken/package.json": "{",
    "packages/Pods/vendor/package.json": '{"name":"vendor"}',
    "packages/node_modules/vendor/package.json": '{"name":"vendor"}',
  });
  const metro = consumer("@expo/metro-config")("./build/getWatchFolders.js");
  assert.deepEqual(metro.resolveAllWorkspacePackageJsonPaths(directory), [
    join(directory, "packages/shared/package.json"),
  ]);
});

test("prebuild's template rename touches only selected files in a temporary fixture", async (t) => {
  const directory = await fixture(t, {
    "app.json": '"Hello App Display Name"',
    "android/app/build.gradle": "HelloWorld helloworld",
    "android/app/src/main/res/values/strings.xml": "Hello App Display Name",
    "ios/Receipt.xcodeproj/project.pbxproj": "HelloWorld",
    "unselected.txt": "HelloWorld",
  });
  const rename = cli("./build/src/prebuild/renameTemplateAppName.js");
  const files = await rename.getTemplateFilesToRenameAsync(directory);
  assert.deepEqual(files.sort(), [
    "android/app/build.gradle",
    "android/app/src/main/res/values/strings.xml",
    "app.json",
    "ios/Receipt.xcodeproj/project.pbxproj",
  ]);
  await rename.renameTemplateAppNameAsync(directory, { expName: "Receipt & Evidence", files });
  assert.equal(await readFile(join(directory, "android/app/build.gradle"), "utf8"), "ReceiptEvidence receiptevidence");
  assert.equal(
    await readFile(join(directory, "android/app/src/main/res/values/strings.xml"), "utf8"),
    "Receipt &amp; Evidence",
  );
  assert.equal(await readFile(join(directory, "unselected.txt"), "utf8"), "HelloWorld");
});

test("fingerprint ignores preserve dotfiles, negation, parent paths and directory pruning", () => {
  const paths = consumer("@expo/fingerprint")("./build/utils/Path.js");
  const matches = paths.buildPathMatchObjects([
    "**/node_modules/**",
    "!**/node_modules/keep/**",
    "cache/**",
    "!cache/keep.txt",
    "generated/**/*",
    "build/",
  ]);
  paths.appendIgnorePath(matches, "**/.cache/**");
  for (const [file, ignored] of [
    ["../node_modules/pkg/a.ts", true],
    ["../../node_modules/keep/a.ts", false],
    [".cache/a", true],
    ["cache/.hidden", true],
    ["cache/keep.txt", false],
    ["src/a.ts", false],
  ] as const) {
    assert.equal(paths.isIgnoredPathWithMatchObjects(file, matches), ignored, file);
  }
  const directories = paths.buildDirMatchObjects(matches);
  assert.equal(paths.isIgnoredPathWithMatchObjects("generated", directories), true);
  assert.equal(paths.isIgnoredPathWithMatchObjects("build", directories), true);
  assert.equal(paths.isIgnoredPathWithMatchObjects("cache", directories), false);
});

// This helper has no identified command caller; exercise cancellation without
// claiming that an Expo command uses it. Input is bounded to three files.
test("CLI glob helper returns the first match and completes cancellation", { timeout: 5000 }, async (t) => {
  const directory = await fixture(t, { "a.txt": "", "b.txt": "", ".hidden.txt": "" });
  const { anyMatchAsync } = cli("./build/src/utils/glob.js");
  const matches = await anyMatchAsync("*.txt", { cwd: directory, dot: true });
  assert.equal(matches.length, 1);
  assert.ok(["a.txt", "b.txt", ".hidden.txt"].includes(matches[0]));
  assert.deepEqual(await anyMatchAsync("*.missing", { cwd: directory }), []);
});

const plugin = {
  packageName: "fixture-plugin",
  packageRoot: resolve(tmpdir(), "receipt-plugin"),
  cliExtensions: {
    description: "Fixture commands",
    entryPoint: "unused.js",
    commands: [
      {
        name: "inspect",
        title: "Inspect",
        environments: ["mcp"],
        parameters: [
          { name: "count", type: "number" },
          { name: "confirm", type: "confirm" },
          { name: "label", type: "text" },
        ],
      },
      { name: "local", title: "Local", environments: ["cli"] },
    ],
  },
};

test("CLI plugin schemas keep validation issues and consumer error formatting", () => {
  const { PluginSchema, DevToolsPluginOutputSchema } = cli(
    "./build/src/start/server/devtools/DevToolsPlugin.schema.js",
  );
  const { validate, ValidationError } = cli("@expo/schema-utils");
  assert.doesNotThrow(() => validate(PluginSchema, plugin));
  assert.throws(
    () => validate(PluginSchema, { ...plugin, packageName: "" }),
    (error: unknown) =>
      error instanceof Error &&
      error instanceof ValidationError &&
      "errors" in error &&
      Array.isArray(error.errors) &&
      error.errors.some((issue: { path: string }) => issue.path === ".packageName"),
  );
  const { DevToolsPlugin } = cli("./build/src/start/server/devtools/DevToolsPlugin.js");
  assert.throws(
    () => new DevToolsPlugin({ ...plugin, packageName: "" }, tmpdir()),
    /Invalid plugin configuration:.*\n/s,
  );
  const outputs = [
    { type: "text", text: "ok", level: "info" },
    { type: "audio", url: "https://example.invalid/audio" },
    { type: "image", url: "https://example.invalid/image", text: "caption" },
  ];
  assert.doesNotThrow(() => validate(DevToolsPluginOutputSchema, outputs));
  assert.throws(() => validate(DevToolsPluginOutputSchema, [{ type: "image", url: "invalid" }]), ValidationError);
});

test("MCP registration uses the supplied Zod and preserves serialized command parameters", async () => {
  const { addMcpCapabilities } = cli("./build/src/start/server/mcp/MCPDevToolsPluginCLIExtensions.js");
  const { z } = contract("zod");
  let registrations = 0;
  await addMcpCapabilities(
    {
      registerTool(
        name: string,
        options: { inputSchema: { parameters: { safeParse: (value: unknown) => { success: boolean } } } },
      ) {
        registrations++;
        assert.equal(name, "fixture-plugin");
        // The CLI now receives its schema implementation from the transport.
        // Check emitted JSON as well as parsing; the optional tunnel is not started.
        assert.ok(options.inputSchema.parameters instanceof z.ZodObject);
        const emitted = z.toJSONSchema(z.object(options.inputSchema));
        const parameters = emitted.properties.parameters;
        assert.equal(parameters.type, "object");
        assert.equal(parameters.additionalProperties, false);
        assert.deepEqual(parameters.required, ["command"]);
        assert.deepEqual(parameters.properties.command.enum, ["inspect"]);
        for (const [name, type] of [
          ["count", "number"],
          ["confirm", "boolean"],
          ["label", "string"],
        ]) {
          assert.equal(parameters.properties[name].type, type);
        }
        const schema = options.inputSchema.parameters;
        for (const value of [{ command: "inspect" }, { command: "inspect", count: 2, confirm: true, label: "receipt" }])
          assert.equal(schema.safeParse(value).success, true);
        for (const value of [
          {},
          { command: "local" },
          { command: "unknown" },
          { command: "inspect", extra: true },
          { command: "inspect", count: "2" },
          { command: "inspect", confirm: "yes" },
          { command: "inspect", label: 3 },
        ])
          assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));
      },
    },
    { devtoolsPluginManager: { queryPluginsAsync: async () => [plugin] } },
    z,
  );
  assert.equal(registrations, 1);
});

test("MCP registration retains the legacy transport's own Zod 3 schema identity", async () => {
  const { addMcpCapabilities } = cli("./build/src/start/server/mcp/MCPDevToolsPluginCLIExtensions.js");
  // Zod's compatibility export exercises the existing tunnel's raw-schema boundary
  // without adding the optional expo-mcp dependency to the application graph.
  const { z } = contract("zod/v3");
  let registrations = 0;
  await addMcpCapabilities(
    {
      registerTool(name: string, options: { inputSchema: { parameters: unknown } }) {
        registrations++;
        assert.equal(name, "fixture-plugin");
        const parameters = z.object(options.inputSchema).shape.parameters;
        assert.ok(parameters instanceof z.ZodObject);
        assert.equal(parameters._def.unknownKeys, "strict");
        assert.deepEqual(parameters.shape.command._def.values, ["inspect"]);
        for (const [name, type] of [
          ["count", "ZodNumber"],
          ["confirm", "ZodBoolean"],
          ["label", "ZodString"],
        ]) {
          assert.equal(parameters.shape[name]._def.typeName, "ZodOptional");
          assert.equal(parameters.shape[name]._def.innerType._def.typeName, type);
        }
      },
    },
    { devtoolsPluginManager: { queryPluginsAsync: async () => [plugin] } },
    z,
  );
  assert.equal(registrations, 1);
});
