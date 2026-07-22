const std = @import("std");
const optimizer = @import("optimizer");

test "package exports the versioned non-economic contract" {
    try std.testing.expectEqualStrings("economic-kernel-cli/v1", optimizer.contract_version);
    try std.testing.expectEqualStrings("0.1.0", optimizer.package_version);
    try std.testing.expectEqualStrings("not_implemented", optimizer.economics_status);
}
