// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FETCH_GRASS" && message.handle) {
        const url = `https://solved.ac/api/v3/user/grass?handle=${message.handle}&topic=default`;

        fetch(url)
            .then(res => res.json())
            .then(json => {
                // 응답 구조가 { grass: [ { date, value }, … ] }
                const grassArr = Array.isArray(json.grass) ? json.grass : [];
                const today = new Date().toISOString().slice(0, 10);
                const todayEntry = grassArr.find(entry => entry.date === today);
                // value 필드에서 오늘 푼 개수를 꺼내고, 없으면 0
                sendResponse({ count: todayEntry ? todayEntry.value : 0 });
            })
            .catch(err => {
                console.error("API 오류:", err);
                sendResponse({ count: -1 });
            });

        // 비동기 sendResponse 사용을 위해 true 리턴
        return true;
    }
});
