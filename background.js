chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FETCH_GRASS" && message.handle) {
        const url = `https://solved.ac/api/v3/user/grass?handle=${message.handle}&topic=default`;

        fetch(url, { cache: "no-store" })
            .then((r) => r.json())
            .then((json) => {
                const today = getSolvedAcDate();
                const arr = Array.isArray(json.grass) ? json.grass : [];

                const todayEntry = arr.find((e) => e.date === today);
                const count = todayEntry ? Number(todayEntry.value) || 0 : 0;

                // 마지막으로 푼 날짜 (today 포함해 뒤로 탐색)
                let lastSolvedDate = null;
                for (const e of arr) {
                    if (!e || !e.date) continue;
                    const v = Number(e.value) || 0;
                    if (v > 0 && e.date <= today) {
                        if (!lastSolvedDate || e.date > lastSolvedDate) {
                            lastSolvedDate = e.date;
                        }
                    }
                }

                let reverseStreak = 0;
                if (count === 0) {
                    reverseStreak = lastSolvedDate
                        ? Math.max(1, diffDays(today, lastSolvedDate))
                        : 1;
                }

                console.log("[BG]", message.handle, {
                    count,
                    lastSolvedDate,
                    reverseStreak,
                    today,
                });
                sendResponse({ count, lastSolvedDate, reverseStreak, today });
            })
            .catch((err) => {
                console.error("[BG] error", err);
                sendResponse({
                    count: -1,
                    lastSolvedDate: null,
                    reverseStreak: 0,
                    today: getSolvedAcDate(),
                });
            });
        return true;
    }
});

function getSolvedAcDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now.toLocaleDateString("en-CA");
}

function diffDays(a, b) {
    // "YYYY-MM-DD"
    const da = new Date(a),
        db = new Date(b);
    da.setHours(0, 0, 0, 0);
    db.setHours(0, 0, 0, 0);
    return Math.round((da - db) / (1000 * 60 * 60 * 24));
}