module typecheck_pass
end-module

fn add(a: Int, b: Int) -> Int {
  a + b
}

fn greet(name: String) -> String {
  "hello " ++ name
}

fn is_positive(x: Int) -> Bool {
  x > 0
}

fn main() -> Int {
  add(1, 2)
}
