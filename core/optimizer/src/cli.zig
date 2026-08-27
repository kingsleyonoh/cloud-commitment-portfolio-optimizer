const std = @import("std");
const optimizer = @import("optimizer");

const invalid_response = "{\"contract_version\":\"economic-kernel-cli/v1\",\"error\":{\"code\":\"INVALID_REQUEST\",\"message\":\"Request does not match the canonical CLI contract.\"},\"ok\":false,\"request_id\":null}\n";

pub fn main() void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const input = std.io.getStdIn().reader().readAllAlloc(allocator, 1024 * 1024) catch {
        emit(invalid_response, 2);
    };
    const outcome = optimizer.process(allocator, input) catch {
        emit(invalid_response, 2);
    };
    emit(outcome.stdout, outcome.exit_code);
}

fn emit(output: []const u8, exit_code: u8) noreturn {
    std.io.getStdOut().writer().writeAll(output) catch std.process.exit(2);
    std.process.exit(exit_code);
}
