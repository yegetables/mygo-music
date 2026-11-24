plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.egoist.music"
    compileSdk = 35
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "dev.egoist.music"
        minSdk = 31
        targetSdk = 35
        val verName = (project.findProperty("appVersion") as String?)?.ifBlank { null } ?: "0.1.25"
        val explicitCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull()
        val baseVer = verName.removePrefix("v").substringBefore("-").substringBefore("+")
        val verParts = baseVer.split(".").mapNotNull { it.toIntOrNull() }
        val devBuild = Regex("""-dev[.-](\d+)""").find(verName)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
        versionCode = explicitCode ?: if (verParts.size >= 3) {
            verParts[0] * 100_000_000 + verParts[1] * 1_000_000 + verParts[2] * 10_000 + devBuild
        } else {
            1_250_000 + devBuild
        }
        versionName = verName

        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    signingConfigs {
        create("releaseSelfSigned") {
            val ksFile = file("release.jks")
            if (ksFile.exists()) {
                storeFile = ksFile
                storePassword = System.getenv("MYGO_ANDROID_STORE_PASS") ?: "mygomusic123"
                keyAlias = System.getenv("MYGO_ANDROID_KEY_ALIAS") ?: "mygomusic"
                keyPassword = System.getenv("MYGO_ANDROID_KEY_PASS") ?: "mygomusic123"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val ksFile = file("release.jks")
            signingConfig = if (ksFile.exists()) {
                signingConfigs.getByName("releaseSelfSigned")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
    implementation("androidx.media3:media3-common:1.5.1")
}
