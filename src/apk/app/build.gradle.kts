import java.util.Properties

plugins {
    id("com.android.application")
}

val localProps = Properties().also { props ->
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { props.load(it) }
}

android {
    namespace = "su.p3o.yobapub"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "su.p3o.yobapub"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "APP_URL", "\"http://yobapub.3po.su\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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

dependencies {
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.leanback:leanback:1.0.0")
}
