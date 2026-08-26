const std = @import("std");
const cases = @import("case_contract.zig");
const json = @import("json_contract.zig");

pub const contract_version = "economic-kernel-cli/v1";
pub const package_version = "0.1.0";
pub const economics_status = "implemented";

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
    try output.writer().writeAll(",\"validation\":{\"economics_computed\":true,\"schema_valid\":true}}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 0 };
}

fn evaluate(allocator: std.mem.Allocator, request_id: []const u8, payload: std.json.Value) !Outcome {
    if (!json.exactObject(payload, case_payload_keys)) return invalid(allocator, "INVALID_REQUEST");
    const case = payload.object.get("case").?;
    if (!cases.validate(case)) return invalid(allocator, "INVALID_REQUEST");
    const evaluation = compute(case) catch return invalid(allocator, "INVALID_REQUEST");
    var output = std.ArrayList(u8).init(allocator);
    errdefer output.deinit();
    try output.writer().print("{{\"contract_version\":\"economic-kernel-cli/v1\",\"evaluation\":{{\"downside_loss_cents\":\"{d}\",\"gross_savings_cents\":\"{d}\",\"liquidity_penalty_cents\":\"{d}\",\"net_savings_cents\":\"{d}\",\"unused_waste_cents\":\"{d}\",\"upfront_amortization_cents\":\"{d}\"}},\"ok\":true,\"request_id\":", .{
        evaluation.downside_loss_cents,
        evaluation.gross_savings_cents,
        evaluation.liquidity_penalty_cents,
        evaluation.net_savings_cents,
        evaluation.unused_waste_cents,
        evaluation.upfront_amortization_cents,
    });
    try std.json.stringify(request_id, .{}, output.writer());
    try output.writer().writeAll("}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 0 };
}

fn successContract(allocator: std.mem.Allocator, request_id: []const u8) !Outcome {
    var output = std.ArrayList(u8).init(allocator);
    errdefer output.deinit();
    try output.writer().writeAll("{\"capabilities\":[\"contract\",\"validate\",\"evaluate\"],\"contract_version\":\"economic-kernel-cli/v1\",\"economics_status\":\"implemented\",\"numeric_encoding\":\"canonical_decimal_strings\",\"ok\":true,\"package_version\":\"0.1.0\",\"request_id\":");
    try std.json.stringify(request_id, .{}, output.writer());
    try output.writer().writeAll("}\n");
    return .{ .stdout = try output.toOwnedSlice(), .exit_code = 0 };
}

const Evaluation = struct {
    downside_loss_cents: i128,
    gross_savings_cents: i128,
    liquidity_penalty_cents: i128,
    net_savings_cents: i128,
    unused_waste_cents: i128,
    upfront_amortization_cents: i128,
};

fn compute(case: std.json.Value) !Evaluation {
    const object = case.object;
    const dimensions = object.get("dimensions").?.object;
    const inputs = object.get("inputs").?.object;
    if (std.mem.eql(u8, stringField(dimensions, "instrument"), "no_action")) {
        return .{
            .downside_loss_cents = 0,
            .gross_savings_cents = 0,
            .liquidity_penalty_cents = 0,
            .net_savings_cents = 0,
            .unused_waste_cents = 0,
            .upfront_amortization_cents = 0,
        };
    }
    const on_demand_cost_cents = try integerField(inputs, "on_demand_cost_cents");
    const commitment_effective_cost_cents = try integerField(inputs, "commitment_effective_cost_cents");
    const committed_capacity_cents = try integerField(inputs, "committed_capacity_cents");
    const eligible_usage_cents = try integerField(inputs, "eligible_usage_cents");
    const upfront_cost_cents = try integerField(inputs, "upfront_cost_cents");
    const term_months = try integerField(inputs, "term_months");
    const liquidity_penalty_bps = try integerField(inputs, "liquidity_penalty_bps");
    const gross_savings_cents = on_demand_cost_cents - commitment_effective_cost_cents;
    const unused_waste_cents = @max(@as(i128, 0), committed_capacity_cents - eligible_usage_cents);
    const upfront_amortization_cents = divRoundHalfUp(upfront_cost_cents, term_months);
    const liquidity_penalty_cents = divRoundHalfUp(upfront_cost_cents * liquidity_penalty_bps, 10_000);
    const net_savings_cents = gross_savings_cents - unused_waste_cents - upfront_amortization_cents - liquidity_penalty_cents;
    return .{
        .downside_loss_cents = @max(@as(i128, 0), -net_savings_cents),
        .gross_savings_cents = gross_savings_cents,
        .liquidity_penalty_cents = liquidity_penalty_cents,
        .net_savings_cents = net_savings_cents,
        .unused_waste_cents = unused_waste_cents,
        .upfront_amortization_cents = upfront_amortization_cents,
    };
}

fn integerField(object: std.json.ObjectMap, key: []const u8) !i128 {
    return std.fmt.parseInt(i128, stringField(object, key), 10);
}

fn stringField(object: std.json.ObjectMap, key: []const u8) []const u8 {
    return object.get(key).?.string;
}

fn divRoundHalfUp(numerator: i128, denominator: i128) i128 {
    return @divTrunc(numerator + @divTrunc(denominator, 2), denominator);
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
