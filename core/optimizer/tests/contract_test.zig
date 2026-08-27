const std = @import("std");
const optimizer = @import("optimizer");

fn expectOutcome(input: []const u8, exit_code: u8, stdout: []const u8) !void {
    const outcome = try optimizer.process(std.testing.allocator, input);
    defer std.testing.allocator.free(outcome.stdout);
    try std.testing.expectEqual(exit_code, outcome.exit_code);
    try std.testing.expectEqualStrings(stdout, outcome.stdout);
}

test "contract response is canonical and declares implemented economics" {
    const input = "{\"command\":\"contract\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{},\"request_id\":\"zig-test\"}\n";
    const expected = "{\"capabilities\":[\"contract\",\"validate\",\"evaluate\"],\"contract_version\":\"economic-kernel-cli/v1\",\"economics_status\":\"implemented\",\"numeric_encoding\":\"canonical_decimal_strings\",\"ok\":true,\"package_version\":\"0.1.0\",\"request_id\":\"zig-test\"}\n";
    try expectOutcome(input, 0, expected);
}

test "evaluate computes deterministic cents formulas" {
    const input = "{\"command\":\"evaluate\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{\"case\":{\"case_id\":\"aws-compute-savings-plan-partial-utilization\",\"case_version\":\"economic-kernel-case/v1\",\"dimensions\":{\"instrument\":\"compute_savings_plan\",\"payment_option\":\"no_upfront\",\"provider\":\"aws\",\"region\":\"us-east-1\",\"tenant_reporting_currency\":\"USD\",\"term_months\":\"12\"},\"expected\":{\"downside_loss_cents\":\"0\",\"gross_savings_cents\":\"280000\",\"liquidity_penalty_cents\":\"0\",\"net_savings_cents\":\"40000\",\"unused_waste_cents\":\"240000\",\"upfront_amortization_cents\":\"0\"},\"inputs\":{\"commitment_effective_cost_cents\":\"820000\",\"committed_capacity_cents\":\"1000000\",\"eligible_usage_cents\":\"760000\",\"liquidity_penalty_bps\":\"0\",\"on_demand_cost_cents\":\"1100000\",\"term_months\":\"12\",\"upfront_cost_cents\":\"0\"},\"operation\":\"evaluate\",\"oracle\":{\"owner\":\"phase1-zig-economic-kernel-formulas-rounding\",\"prd_ref\":\"5.5\",\"status\":\"implemented\"},\"units\":{\"commitment_effective_cost_cents\":\"tenant_reporting_currency_minor_unit\",\"committed_capacity_cents\":\"tenant_reporting_currency_minor_unit\",\"eligible_usage_cents\":\"tenant_reporting_currency_minor_unit\",\"liquidity_penalty_bps\":\"basis_points\",\"on_demand_cost_cents\":\"tenant_reporting_currency_minor_unit\",\"term_months\":\"count\",\"upfront_cost_cents\":\"tenant_reporting_currency_minor_unit\"}}},\"request_id\":\"zig-test\"}\n";
    const expected = "{\"contract_version\":\"economic-kernel-cli/v1\",\"evaluation\":{\"downside_loss_cents\":\"0\",\"gross_savings_cents\":\"280000\",\"liquidity_penalty_cents\":\"0\",\"net_savings_cents\":\"40000\",\"unused_waste_cents\":\"240000\",\"upfront_amortization_cents\":\"0\"},\"ok\":true,\"request_id\":\"zig-test\"}\n";
    try expectOutcome(input, 0, expected);
}

test "invalid and noncanonical requests return a secret-safe stable error" {
    const expected = "{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{\"code\":\"INVALID_REQUEST\",\"message\":\"Request does not match the canonical CLI contract.\"},\"ok\":false,\"request_id\":null}\n";
    try expectOutcome("not-json\n", 2, expected);
    try expectOutcome("{\"request_id\":\"secret\",\"command\":\"contract\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{}}\n", 2, expected);
    try expectOutcome("{\"command\":\"contract\",\"command\":\"evaluate\",\"contract_version\":\"economic-kernel-cli/v1\",\"payload\":{},\"request_id\":\"secret\"}\n", 2, expected);
}
