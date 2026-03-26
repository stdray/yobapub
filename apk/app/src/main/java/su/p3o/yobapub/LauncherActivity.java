package su.p3o.yobapub;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;

import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import java.util.List;

public class LauncherActivity extends Activity {

    private static final Uri LAUNCH_URI = Uri.parse("http://yobapub.3po.su");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String chromePackage = getChromePackage();
        if (chromePackage != null) {
            launchTwa(chromePackage);
        } else {
            launchWebView();
        }
    }

    private void launchTwa(String packageName) {
        CustomTabsClient.bindCustomTabsService(this, packageName, new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                client.warmup(0);
                CustomTabsSession session = client.newSession(null);
                if (session == null) {
                    launchWebView();
                    return;
                }
                TrustedWebActivityIntentBuilder builder =
                        new TrustedWebActivityIntentBuilder(LAUNCH_URI);
                Intent intent = builder.build(session).getIntent();
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(intent);
                finish();
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
            }
        });
    }

    private void launchWebView() {
        Intent intent = new Intent(this, WebViewActivity.class);
        startActivity(intent);
        finish();
    }

    private String getChromePackage() {
        String[] candidates = {
                "com.android.chrome",
                "com.chrome.beta",
                "com.chrome.dev",
                "com.chrome.canary",
                "com.google.android.apps.chrome"
        };
        PackageManager pm = getPackageManager();
        for (String pkg : candidates) {
            Intent serviceIntent = new Intent("android.support.customtabs.action.CustomTabsService");
            serviceIntent.setPackage(pkg);
            List<ResolveInfo> resolved = pm.queryIntentServices(serviceIntent, 0);
            if (resolved != null && !resolved.isEmpty()) {
                return pkg;
            }
        }
        return null;
    }
}
