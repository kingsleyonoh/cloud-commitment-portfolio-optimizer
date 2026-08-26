const std = @import("std");
const fixture_data = @import("fixture_data");

const cases = fixture_data.cases;
const manifest = fixture_data.manifest;

test "fixture corpus contains implemented expected formula values" {
    try std.testing.expect(std.mem.endsWith(u8, cases, "\n"));
    try std.testing.expect(std.mem.endsWith(u8, manifest, "\n"));
    try std.testing.expectEqual(@as(usize, 5), std.mem.count(u8, cases, "\"net_savings_cents\""));
    try std.testing.expectEqual(@as(usize, 5), std.mem.count(u8, cases, "\"status\":\"implemented\""));
    try std.testing.expectEqual(@as(usize, 0), std.mem.count(u8, cases, "\"expected\":null"));
    try std.testing.expect(std.mem.containsAtLeast(u8, manifest, 1, "\"economics_state\":\"implemented\""));
}
