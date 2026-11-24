package dev.egoist.music

object CoreBridge {
    init {
        System.loadLibrary("mygocore")
        System.loadLibrary("mygobridge")
    }

    external fun nativeStart(dataDir: String, cacheDir: String, lang: String): String
    external fun nativeStop()
    external fun nativeCompleteWebSignIn(id: String, cookie: String, error: String)
}
