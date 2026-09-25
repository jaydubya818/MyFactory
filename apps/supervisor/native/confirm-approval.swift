import Foundation
import LocalAuthentication

guard CommandLine.arguments.count == 2 else {
  exit(2)
}

let context = LAContext()
context.localizedCancelTitle = "Cancel approval"
var availabilityError: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
  fputs("Device owner authentication is unavailable.\n", stderr)
  exit(2)
}

let confirmation = DispatchSemaphore(value: 0)
var approved = false
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: CommandLine.arguments[1]) { success, _ in
  approved = success
  confirmation.signal()
}
confirmation.wait()
exit(approved ? 0 : 1)
