// Firebase 웹 앱 설정. apiKey 등은 비밀값이 아니다(Firebase 보안은 firestore.rules가
// 담당하지, 이 설정을 숨기는 데 있지 않다) — 그래서 서버 쪽 .env와 달리 이 파일은
// 그냥 git에 커밋한다.
//
// ↓↓↓ 지금은 로컬 Firebase 에뮬레이터를 가리키도록 되어 있다 ↓↓↓
// 내일 실제 Firebase 프로젝트를 연결할 때 할 일:
//   1. https://console.firebase.google.com 에서 프로젝트를 만들고
//      "웹 앱 추가"로 진짜 firebaseConfig 값을 복사해 온다.
//   2. 아래 firebaseConfig 객체를 그 값으로 통째로 교체한다.
//   3. USE_EMULATORS를 false로 바꾼다.
//   4. .firebaserc의 "default" 프로젝트 ID를 실제 프로젝트 ID로 바꾼다.
//   5. Firestore 콘솔에서 Firestore 사용 설정 + Authentication에서 이메일/비밀번호
//      로그인 방식을 켠다(둘 다 콘솔에서 한 번만 클릭하면 됨).
//   6. 저장소 루트에서: npm install && firebase deploy --only functions,firestore
//   7. 이 파일을 커밋하고 GitHub Pages에 반영한다(main에 병합).

const USE_EMULATORS = true;

const firebaseConfig = {
  apiKey: "demo-key",
  projectId: "demo-olympus-sng",
};

firebase.initializeApp(firebaseConfig);

if (USE_EMULATORS) {
  firebase.auth().useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
  firebase.firestore().useEmulator("127.0.0.1", 8080);
  firebase.functions().useEmulator("127.0.0.1", 5001);
}
