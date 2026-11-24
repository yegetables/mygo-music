#include <jni.h>
#include <dlfcn.h>
#include <stddef.h>

typedef char* (*mygo_start_fn)(char*, char*, char*);
typedef void (*mygo_stop_fn)(void);
typedef void (*mygo_complete_web_signin_fn)(char*, char*, char*);
typedef void (*mygo_free_fn)(char*);

static void* core_handle = NULL;
static mygo_start_fn fn_start = NULL;
static mygo_stop_fn fn_stop = NULL;
static mygo_complete_web_signin_fn fn_complete = NULL;
static mygo_free_fn fn_free = NULL;

static int ensure_loaded(void) {
    if (core_handle != NULL && fn_start != NULL) {
        return 1;
    }
    core_handle = dlopen("libmygocore.so", RTLD_NOW | RTLD_GLOBAL);
    if (!core_handle) {
        return 0;
    }
    fn_start = (mygo_start_fn)dlsym(core_handle, "MyGoStart");
    fn_stop = (mygo_stop_fn)dlsym(core_handle, "MyGoStop");
    fn_complete = (mygo_complete_web_signin_fn)dlsym(core_handle, "MyGoCompleteWebSignIn");
    fn_free = (mygo_free_fn)dlsym(core_handle, "MyGoFree");
    return fn_start != NULL;
}

JNIEXPORT jstring JNICALL
Java_dev_egoist_music_CoreBridge_nativeStart(
    JNIEnv* env, jobject thiz,
    jstring jDataDir, jstring jCacheDir, jstring jLang
) {
    (void)thiz;
    if (!ensure_loaded()) {
        return (*env)->NewStringUTF(env, "{\"error\":\"failed to load libmygocore.so\"}");
    }
    const char* dataDir = (*env)->GetStringUTFChars(env, jDataDir, NULL);
    const char* cacheDir = (*env)->GetStringUTFChars(env, jCacheDir, NULL);
    const char* lang = (*env)->GetStringUTFChars(env, jLang, NULL);

    char* res = fn_start((char*)dataDir, (char*)cacheDir, (char*)lang);

    (*env)->ReleaseStringUTFChars(env, jDataDir, dataDir);
    (*env)->ReleaseStringUTFChars(env, jCacheDir, cacheDir);
    (*env)->ReleaseStringUTFChars(env, jLang, lang);

    if (!res) {
        return (*env)->NewStringUTF(env, "{\"error\":\"empty response from core\"}");
    }
    jstring out = (*env)->NewStringUTF(env, res);
    if (fn_free) {
        fn_free(res);
    }
    return out;
}

JNIEXPORT void JNICALL
Java_dev_egoist_music_CoreBridge_nativeStop(JNIEnv* env, jobject thiz) {
    (void)env;
    (void)thiz;
    if (ensure_loaded() && fn_stop) {
        fn_stop();
    }
}

JNIEXPORT void JNICALL
Java_dev_egoist_music_CoreBridge_nativeCompleteWebSignIn(
    JNIEnv* env, jobject thiz,
    jstring jId, jstring jCookie, jstring jErr
) {
    (void)thiz;
    if (!ensure_loaded() || !fn_complete) {
        return;
    }
    const char* id = (*env)->GetStringUTFChars(env, jId, NULL);
    const char* cookie = (*env)->GetStringUTFChars(env, jCookie, NULL);
    const char* err = (*env)->GetStringUTFChars(env, jErr, NULL);

    fn_complete((char*)id, (char*)cookie, (char*)err);

    (*env)->ReleaseStringUTFChars(env, jId, id);
    (*env)->ReleaseStringUTFChars(env, jCookie, cookie);
    (*env)->ReleaseStringUTFChars(env, jErr, err);
}
