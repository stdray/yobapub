import java.util.Properties

plugins {
    id("com.android.application")
}

val localProps = Properties().also { props ->
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { props.load(it) }
}

val versionProps = Properties().also { props ->
    val f = rootProject.file("version.properties")
    if (f.exists()) f.inputStream().use { props.load(it) }
}

android {
    namespace = "su.p3o.yobapub"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
        if (ksPath != null) {
            create("release") {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    defaultConfig {
        applicationId = "su.p3o.yobapub"
        minSdk = 21
        targetSdk = 35
        versionCode = versionProps.getProperty("versionCode")?.toIntOrNull() ?: 1
        versionName = versionProps.getProperty("versionName") ?: "0.1.0-dev"
        buildConfigField("String", "APP_URL", "\"https://yobapub.3po.su\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            val devUrl = localProps.getProperty("dev.url", "http://10.0.2.2:8080")
            buildConfigField("String", "APP_URL", "\"$devUrl\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}
