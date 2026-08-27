const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const optimizer = b.createModule(.{
        .root_source_file = b.path("core/optimizer/src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    const cli_module = b.createModule(.{
        .root_source_file = b.path("core/optimizer/src/cli.zig"),
        .target = target,
        .optimize = optimize,
    });
    cli_module.addImport("optimizer", optimizer);

    const executable = b.addExecutable(.{
        .name = "cloud-commitment-optimizer",
        .root_module = cli_module,
    });
    b.installArtifact(executable);

    const run_command = b.addRunArtifact(executable);
    run_command.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run the economic-kernel CLI boundary");
    run_step.dependOn(&run_command.step);

    const test_step = b.step("test", "Run Zig unit and contract tests");
    addTest(b, test_step, optimizer, target, optimize, "core/optimizer/tests/smoke.zig");
    addTest(b, test_step, optimizer, target, optimize, "core/optimizer/tests/contract_test.zig");
    addFixtureTest(b, test_step, optimizer, target, optimize);
}

fn addTest(
    b: *std.Build,
    step: *std.Build.Step,
    optimizer: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    path: []const u8,
) void {
    const test_module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    test_module.addImport("optimizer", optimizer);
    const tests = b.addTest(.{ .root_module = test_module });
    step.dependOn(&b.addRunArtifact(tests).step);
}

fn addFixtureTest(
    b: *std.Build,
    step: *std.Build.Step,
    optimizer: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) void {
    const options = b.addOptions();
    options.addOption([]const u8, "cases", readFixture(b, "tests/fixtures/economic_kernel/cases.v1.ndjson"));
    options.addOption([]const u8, "manifest", readFixture(b, "tests/fixtures/economic_kernel/manifest.v1.json"));
    const module = b.createModule(.{
        .root_source_file = b.path("core/optimizer/tests/fixture_contract_test.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("optimizer", optimizer);
    module.addOptions("fixture_data", options);
    step.dependOn(&b.addRunArtifact(b.addTest(.{ .root_module = module })).step);
}

fn readFixture(b: *std.Build, path: []const u8) []const u8 {
    return std.fs.cwd().readFileAlloc(b.allocator, b.pathFromRoot(path), 1024 * 1024) catch @panic("fixture corpus unavailable");
}
