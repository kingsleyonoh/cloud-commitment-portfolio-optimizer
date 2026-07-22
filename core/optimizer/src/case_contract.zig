const std = @import("std");
const json = @import("json_contract.zig");

const case_keys = [_][]const u8{ "case_id", "case_version", "dimensions", "expected", "inputs", "operation", "oracle", "units" };
const dimension_keys = [_][]const u8{ "instrument", "payment_option", "provider", "region", "tenant_reporting_currency", "term_months" };
const input_keys = [_][]const u8{ "commitment_effective_cost_cents", "committed_capacity_cents", "eligible_usage_cents", "liquidity_penalty_bps", "on_demand_cost_cents", "term_months", "upfront_cost_cents" };
const oracle_keys = [_][]const u8{ "owner", "prd_ref", "status" };

pub fn validate(value: std.json.Value) bool {
    if (!json.exactObject(value, &case_keys)) return false;
    const object = value.object;
    return validIdentifier(stringField(object, "case_id")) and
        equals(stringField(object, "case_version"), "economic-kernel-case/v1") and
        validDimensions(object.get("dimensions").?) and
        object.get("expected").? == .null and
        validInputs(object.get("inputs").?) and
        equals(stringField(object, "operation"), "evaluate") and
        validOracle(object.get("oracle").?) and
        validUnits(object.get("units").?);
}

fn validDimensions(value: std.json.Value) bool {
    if (!json.exactObject(value, &dimension_keys)) return false;
    const object = value.object;
    return oneOf(stringField(object, "instrument"), &.{ "compute_savings_plan", "reserved_instance", "azure_reservation", "gcp_cud", "no_action" }) and
        oneOf(stringField(object, "payment_option"), &.{ "all_upfront", "no_upfront", "partial_upfront", "not_applicable" }) and
        oneOf(stringField(object, "provider"), &.{ "aws", "azure", "gcp" }) and
        validDimension(stringField(object, "region")) and
        validCurrency(stringField(object, "tenant_reporting_currency")) and
        decimal(stringField(object, "term_months"), false);
}

fn validInputs(value: std.json.Value) bool {
    if (!json.exactObject(value, &input_keys)) return false;
    const object = value.object;
    for (input_keys) |key| {
        if (!decimal(stringField(object, key), std.mem.eql(u8, key, "term_months"))) return false;
    }
    return true;
}

fn validOracle(value: std.json.Value) bool {
    if (!json.exactObject(value, &oracle_keys)) return false;
    const object = value.object;
    return equals(stringField(object, "owner"), "phase1-zig-economic-kernel-formulas-rounding") and
        equals(stringField(object, "prd_ref"), "5.5") and
        equals(stringField(object, "status"), "deferred_to_formula_item");
}

fn validUnits(value: std.json.Value) bool {
    if (!json.exactObject(value, &input_keys)) return false;
    const object = value.object;
    for (input_keys) |key| {
        const expected = if (std.mem.eql(u8, key, "liquidity_penalty_bps"))
            "basis_points"
        else if (std.mem.eql(u8, key, "term_months"))
            "count"
        else
            "tenant_reporting_currency_minor_unit";
        if (!equals(stringField(object, key), expected)) return false;
    }
    return true;
}

fn stringField(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    return if (value == .string) value.string else null;
}

fn decimal(value: ?[]const u8, positive: bool) bool {
    const text = value orelse return false;
    if (text.len == 0 or (text.len > 1 and text[0] == '0')) return false;
    if (positive and std.mem.eql(u8, text, "0")) return false;
    for (text) |character| if (character < '0' or character > '9') return false;
    return true;
}

fn validIdentifier(value: ?[]const u8) bool {
    const text = value orelse return false;
    if (text.len == 0 or text.len > 96 or text[0] == '-' or text[text.len - 1] == '-') return false;
    for (text) |character| {
        if (!std.ascii.isLower(character) and !std.ascii.isDigit(character) and character != '-') return false;
    }
    return true;
}

fn validDimension(value: ?[]const u8) bool {
    const text = value orelse return false;
    if (text.len == 0 or text.len > 64) return false;
    for (text) |character| {
        if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_') return false;
    }
    return true;
}

fn validCurrency(value: ?[]const u8) bool {
    const text = value orelse return false;
    if (text.len != 3) return false;
    for (text) |character| if (!std.ascii.isUpper(character)) return false;
    return true;
}

fn equals(value: ?[]const u8, expected: []const u8) bool {
    return if (value) |text| std.mem.eql(u8, text, expected) else false;
}

fn oneOf(value: ?[]const u8, allowed: []const []const u8) bool {
    for (allowed) |candidate| if (equals(value, candidate)) return true;
    return false;
}
