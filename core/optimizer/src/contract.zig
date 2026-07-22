const std = @import("std");
const cases = @import("case_contract.zig");
const json = @import("json_contract.zig");

pub const contract_version = "economic-kernel-cli/v1";
pub const package_version = "0.1.0";
pub const economics_status = "not_implemented";

pub const Outcome = struct {
    stdout: []u8,
    exit_code: u8,
};

const envelope_keys = &.{ "command", "contract_version", "payload", "request_id" };
const case_payload_keys = &.{"case"};

pub fn process(allocator: std.mem.Allocator, input: []const u8) !Outcome {
    const parsed = json.parseCanonical(allocator, input) catch return invalid(allocator, "INVALID_REQUEST");
    defer parsed.deinit();
    if (!validEnvelope(parsed.value)) return invalid(allocator, "INVALID_REQUEST");

    const object = parsed.value.object;
    const command = object.get("command").?.string;
    const request_id = object.get("request_id").?.string;
    const payload = object.get("payload").?;
    if (std.mem.eql(u8, command, "contract")) {
        if (!json.exactObject(payload, &.{})) return invalid(allocator, "INVALID_REQUEST");
        return successContract(allocator, request_id);
    }
    if (std.mem.eql(u8, command, "validate")) return validate(allocator, request_id, payload);
    if (std.mem.eql(u8, command, "evaluate")) return evaluate(allocator, request_id, payload);
    return invalid(allocator, "INVALID_COMMAND");
}

fn validEnvelope(value: std.json.Value) bool {
    if (!json.exactObject(value, envelope_keys)) return false;
    const object = value.object;
    const command = object.get("command").?;
    const version = object.get("contract_version").?;
    const payload = object.get("payload").?;
    const request_id = object.get("request_id").?;
    if (command != .string or version != .string or payload != .object or request_id != .string) return false;
    return std.mem.eql(u8, version.string, contract_version) and validRequestId(request_id.string);
}

fn validRequestId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |character| if (std.ascii.isControl(character)) return false;
    return true;
}

fn validate(allocator: std.mem.Allocator, request_id: []const u8, payload: std.json.Value) !Outcome {
    if (!json.exactObject(payload, case_payload_keys)) return invalid(allocator, "INVALID_REQUEST");
    if (!cases.validate(payload.object.get("case").?)) return invalid(allocator, "INVALID_REQUEST");
    var output = std.ArrayList(u8).init(allocator);
    errdefer output.deinit();
    try output.writer().writeAll("{\"contract_version\":\"economic-kernel-cli/v1\",\"ok\":true,\"request_id\":");
    try std.json.stringify(request_id, .{}, output.writer());
    try output.writer().writeAll(",\"validation\":{\"economics_computed\":false,\"schema_valid\":true}}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 0 };
}

fn evaluate(allocator: std.mem.Allocator, request_id: []const u8, payload: std.json.Value) !Outcome {
    const empty = json.exactObject(payload, &.{});
    const with_case = json.exactObject(payload, case_payload_keys) and cases.validate(payload.object.get("case").?);
    if (!empty and !with_case) return invalid(allocator, "INVALID_REQUEST");
    var output = std.ArrayList(u8).init(allocator);
    errdefer output.deinit();
    try output.writer().writeAll("{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{\"code\":\"NOT_IMPLEMENTED\",\"message\":\"Economic kernel operations are not implemented.\"},\"ok\":false,\"request_id\":");
    try std.json.stringify(request_id, .{}, output.writer());
    try output.writer().writeAll("}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 3 };
}

fn successContract(allocator: std.mem.Allocator, request_id: []const u8) !Outcome {
    var output = std.ArrayList(u8).init(allocator);
    errdefer output.deinit();
    try output.writer().writeAll("{\"capabilities\":[\"contract\",\"validate\",\"evaluate_reserved\"],\"contract_version\":\"economic-kernel-cli/v1\",\"economics_status\":\"not_implemented\",\"numeric_encoding\":\"canonical_decimal_strings\",\"ok\":true,\"package_version\":\"0.1.0\",\"request_id\":");
    try std.json.stringify(request_id, .{}, output.writer());
    try output.writer().writeAll("}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 0 };
}

fn invalid(allocator: std.mem.Allocator, code: []const u8) !Outcome {
    const message = if (std.mem.eql(u8, code, "INVALID_COMMAND"))
        "Command is not supported by this CLI contract."
    else
        "Request does not match the canonical CLI contract.";
    const stdout = try std.fmt.allocPrint(
        allocator,
        "{{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{{\"code\":\"{s}\",\"message\":\"{s}\"}},\"ok\":false,\"request_id\":null}}\n",
        .{ code, message },
    );
    return .{ .stdout = stdout, .exit_code = 2 };
}
