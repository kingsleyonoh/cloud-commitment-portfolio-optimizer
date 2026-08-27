const std = @import("std");

pub const Parsed = std.json.Parsed(std.json.Value);

pub fn parseCanonical(allocator: std.mem.Allocator, input: []const u8) !Parsed {
    if (input.len < 3 or input.len > 1024 * 1024) return error.InvalidRequest;
    if (input[input.len - 1] != '\n' or input[input.len - 2] == '\n') return error.InvalidRequest;
    if (std.mem.indexOfScalar(u8, input, '\r') != null) return error.InvalidRequest;
    const body = input[0 .. input.len - 1];
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch {
        return error.InvalidRequest;
    };
    errdefer parsed.deinit();
    try validateCanonicalValue(parsed.value);

    var canonical = std.ArrayList(u8).init(allocator);
    defer canonical.deinit();
    try writeCanonical(parsed.value, canonical.writer());
    if (!std.mem.eql(u8, body, canonical.items)) return error.InvalidRequest;
    return parsed;
}

pub fn exactObject(value: std.json.Value, keys: []const []const u8) bool {
    if (value != .object or value.object.count() != keys.len) return false;
    var iterator = value.object.iterator();
    var index: usize = 0;
    while (iterator.next()) |entry| : (index += 1) {
        if (!std.mem.eql(u8, entry.key_ptr.*, keys[index])) return false;
    }
    return true;
}

fn validateCanonicalValue(value: std.json.Value) !void {
    switch (value) {
        .integer, .float, .number_string => return error.InvalidRequest,
        .array => |array| for (array.items) |item| try validateCanonicalValue(item),
        .object => |object| {
            var iterator = object.iterator();
            var previous: ?[]const u8 = null;
            while (iterator.next()) |entry| {
                if (previous) |key| {
                    if (std.mem.order(u8, key, entry.key_ptr.*) != .lt) return error.InvalidRequest;
                }
                previous = entry.key_ptr.*;
                try validateCanonicalValue(entry.value_ptr.*);
            }
        },
        else => {},
    }
}

fn writeCanonical(value: std.json.Value, writer: anytype) anyerror!void {
    switch (value) {
        .null => try writer.writeAll("null"),
        .bool => |boolean| try writer.writeAll(if (boolean) "true" else "false"),
        .string => |string| try std.json.stringify(string, .{}, writer),
        .array => |array| try writeArray(array, writer),
        .object => |object| try writeObject(object, writer),
        else => return error.InvalidRequest,
    }
}

fn writeArray(array: std.json.Array, writer: anytype) anyerror!void {
    try writer.writeByte('[');
    for (array.items, 0..) |item, index| {
        if (index != 0) try writer.writeByte(',');
        try writeCanonical(item, writer);
    }
    try writer.writeByte(']');
}

fn writeObject(object: std.json.ObjectMap, writer: anytype) anyerror!void {
    try writer.writeByte('{');
    var iterator = object.iterator();
    var index: usize = 0;
    while (iterator.next()) |entry| : (index += 1) {
        if (index != 0) try writer.writeByte(',');
        try std.json.stringify(entry.key_ptr.*, .{}, writer);
        try writer.writeByte(':');
        try writeCanonical(entry.value_ptr.*, writer);
    }
    try writer.writeByte('}');
}
