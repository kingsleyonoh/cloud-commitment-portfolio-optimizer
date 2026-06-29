const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const optimizer = b.addExecutable(.{
        .name = "ccpo-optimizer",
        .root_source_file = b.path("core/optimizer/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(optimizer);

    const replay = b.addExecutable(.{
        .name = "ccpo-replay",
        .root_source_file = b.path("core/replay/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(replay);

    const optimizer_tests = b.addTest(.{
        .root_source_file = b.path("core/optimizer/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    const replay_tests = b.addTest(.{
        .root_source_file = b.path("core/replay/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    const test_step = b.step("test", "Run Zig optimizer and replay tests");
    test_step.dependOn(&b.addRunArtifact(optimizer_tests).step);
    test_step.dependOn(&b.addRunArtifact(replay_tests).step);
}
