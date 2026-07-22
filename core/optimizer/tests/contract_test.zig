const std = @import("std");
const optimizer = @import("optimizer");

fn expectOutcome(input: []const u8, exit_code: u8, stdout: []const u8) !void {
    const outcome = try optimizer.process(std.testing.allocator, input);
    defer std.testing.allocator.free(outcome.stdout);
    try std.testing.expectEqual(exit_code, outcome.exit_code);
    try std.testing.expectEqualStrings(stdout, outcome.stdout);
}

test "contract response is canonical and declares no economics" {
    const input = "{\"command\":\"contract\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{},\"request_id\":\"zig-test\"}\n";
    const expected = "{\"capabilities\":[\"contract\",\"validate\",\"evaluate_reserved\"],\"contract_version\":\"economic-kernel-cli/v1\",\"economics_status\":\"not_implemented\",\"numeric_encoding\":\"canonical_decimal_strings\",\"ok\":true,\"package_version\":\"0.1.0\",\"request_id\":\"zig-test\"}\n";
    try expectOutcome(input, 0, expected);
}

test "reserved evaluate is stable and exits three" {
    const input = "{\"command\":\"evaluate\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{},\"request_id\":\"zig-test\"}\n";
    const expected = "{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{\"code\":\"NOT_IMPLEMENTED\",\"message\":\"Economic kernel operations are not implemented.\"},\"ok\":false,\"request_id\":\"zig-test\"}\n";
    try expectOutcome(input, 3, expected);
}

test "invalid and noncanonical requests return a secret-safe stable error" {
    const expected = "{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{\"code\":\"INVALID_REQUEST\",\"message\":\"Request does not match the canonical CLI contract.\"},\"ok\":false,\"request_id\":null}\n";
    try expectOutcome("not-json\n", 2, expected);
    try expectOutcome("{\"request_id\":\"secret\",\"command\":\"contract\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{}}\n", 2, expected);
    try expectOutcome("{\"command\":\"contract\",\"command\":\"evaluate\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{},\"request_id\":\"secret\"}\n", 2, expected);
}
