module effects_fail
end-module

fn log_msg(msg: String) -> String ! { log } {
  msg
}

fn bad() -> String {
  log_msg("oops")
}
