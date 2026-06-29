const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("ccpo optimizer skeleton\n", .{});
}

test "optimizer skeleton links" {
    try std.testing.expectEqualStrings("ccpo", "ccpo");
}
