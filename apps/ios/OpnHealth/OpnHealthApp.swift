import SwiftUI

@main
struct OpnHealthApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                Tab("Search", systemImage: "magnifyingglass") {
                    NavigationStack { SearchView() }
                }
                Tab("Ledger", systemImage: "scroll") {
                    NavigationStack { LedgerView() }
                }
            }
            .tint(.primary)
        }
    }
}
