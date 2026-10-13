import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let controller = UIViewController()
        let text = UITextView()
        text.isEditable = false
        text.font = .systemFont(ofSize: 20)
        text.backgroundColor = .systemBackground
        text.text = "Foregather native checks\n\nRunning…"
        controller.view.backgroundColor = .systemBackground
        text.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor, constant: 16),
            text.bottomAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor),
            text.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 16),
            text.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -16)
        ])
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = controller
        window?.makeKeyAndVisible()
        DispatchQueue.global(qos: .userInitiated).async {
            let result: String
            do { result = try runNativeChecks() }
            catch { result = "{\"passed\":false,\"consumer\":\"swift\"}" }
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try? Data(result.utf8).write(to: directory.appendingPathComponent("result.json"), options: .atomic)
            DispatchQueue.main.async {
                text.text = result.contains("\"passed\":true")
                    ? "Foregather native checks passed\n\nStored recovery\nCaller validation\nWords and characters\nPublic pairing links\nEncrypted invitation and receipt\nReplay and consumed-state rejection\n\nRunning in iOS Simulator"
                    : "Foregather native checks failed"
                text.textColor = result.contains("\"passed\":true")
                    ? UIColor(red: 0.08, green: 0.4, blue: 0.18, alpha: 1) : .systemRed
            }
        }
        return true
    }
}
