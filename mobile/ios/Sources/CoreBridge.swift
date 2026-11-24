import Foundation

struct CoreStartInfo: Decodable {
    let port: Int?
    let token: String?
    let error: String?
}

final class CoreBridge {
    static let shared = CoreBridge()
    private init() {}

    func start(dataDir: String, cacheDir: String, lang: String) -> CoreStartInfo {
        let rawPtr = dataDir.withCString { dPtr in
            cacheDir.withCString { cPtr in
                lang.withCString { lPtr in
                    MyGoStart(
                        UnsafeMutablePointer(mutating: dPtr),
                        UnsafeMutablePointer(mutating: cPtr),
                        UnsafeMutablePointer(mutating: lPtr)
                    )
                }
            }
        }
        guard let ptr = rawPtr else {
            return CoreStartInfo(port: nil, token: nil, error: "Core returned null")
        }
        defer { MyGoFree(ptr) }
        let jsonStr = String(cString: ptr)
        guard let data = jsonStr.data(using: .utf8),
              let info = try? JSONDecoder().decode(CoreStartInfo.self, from: data) else {
            return CoreStartInfo(port: nil, token: nil, error: "Invalid core response: \(jsonStr)")
        }
        return info
    }

    func stop() {
        MyGoStop()
    }

    func completeWebSignIn(id: String, cookie: String, error: String) {
        id.withCString { idPtr in
            cookie.withCString { cPtr in
                error.withCString { ePtr in
                    MyGoCompleteWebSignIn(
                        UnsafeMutablePointer(mutating: idPtr),
                        UnsafeMutablePointer(mutating: cPtr),
                        UnsafeMutablePointer(mutating: ePtr)
                    )
                }
            }
        }
    }
}
