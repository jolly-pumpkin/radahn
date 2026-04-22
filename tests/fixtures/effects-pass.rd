module effects_pass
end-module

fn log_msg(msg: String) -> String ! { log } {
  msg
}

fn process() -> String ! { log } {
  log_msg("processing")
}

fn pure_add(a: Int, b: Int) -> Int {
  a + b
}
