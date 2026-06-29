const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("ccpo replay skeleton\n", .{});
}

test "replay skeleton links" {
    try std.testing.expectEqualStrings("ccpo", "ccpo");
}
