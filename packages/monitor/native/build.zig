const std = @import("std");
const builtin = @import("builtin");

const zig_version = "0.17.0";
comptime {
    if (!std.mem.eql(u8, builtin.zig_version_string, zig_version))
        @compileError("expected official stable Zig " ++ zig_version ++ "; got " ++ builtin.zig_version_string);
}
const Architecture = enum { all, x64, arm64 };
const architectures = [_]struct { name: Architecture, cpu: std.Target.Cpu.Arch, dlltool_machine: []const u8 }{
    .{ .name = .x64, .cpu = .x86_64, .dlltool_machine = "i386:x86-64" },
    .{ .name = .arm64, .cpu = .aarch64, .dlltool_machine = "arm64" },
};

// Maintainer-only cross-build. Never called by install/release or runtime code.
pub fn build(b: *std.Build) void {
    const architecture = b.option(Architecture, "arch", "Prebuild architecture: x64, arm64, or all (default)") orelse .all;
    const output_directory = b.option([]const u8, "output-dir", "Prebuild destination, relative to native build root (default: ../prebuilds)") orelse "../prebuilds";
    if (b.invalid_user_input) return;

    const headers = b.dependency("node_headers", .{});
    const validate = b.step("test", "Cross-compile selected addons to validate headers and imports without staging prebuilds");

    // One staging step depends on every requested compile: failed builds never
    // replace just one of the checked-in architectures.
    const stage = b.addUpdateSourceFiles();
    for (architectures) |arch| {
        if (architecture != .all and architecture != arch.name) continue;
        const module = b.createModule(.{
            .target = b.resolveTargetQuery(.{ .cpu_arch = arch.cpu, .os_tag = .windows, .abi = .gnu }),
            .optimize = .ReleaseSmall,
            .link_libc = true,
            .strip = true,
            .sanitize_c = .off,
        });
        module.addCSourceFile(.{
            .file = b.path("windows.c"),
            .flags = &.{ "-std=c11", "-Wall", "-Wextra", "-Werror", "-fno-sanitize=all" },
        });
        module.addCMacro("NAPI_VERSION", "8");
        module.addCMacro("BUILDING_NODE_EXTENSION", "1");
        module.addIncludePath(headers.path("include/node"));

        // Generate only this addon's Node-API imports, using Zig's built-in LLVM
        // tool. The file arguments track both the definition and generated library.
        const generate = b.addSystemCommand(&.{ b.graph.zig_exe, "dlltool", "-m", arch.dlltool_machine, "-d" });
        generate.addFileArg(b.path("node-api.def"));
        generate.addArg("-l");
        module.addObjectFile(generate.addOutputFileArg2("node.lib", .{}));
        module.linkSystemLibrary("user32", .{});
        const library = b.addLibrary(.{
            .name = "windows",
            .linkage = .dynamic,
            .root_module = module,
        });
        validate.dependOn(&library.step);
        stage.addCopyFileToSource(library.getEmittedBin(), b.pathJoin(&.{
            output_directory, b.fmt("win32-{s}", .{@tagName(arch.name)}), "windows.node",
        }));
    }
    b.getInstallStep().dependOn(&stage.step);
}
