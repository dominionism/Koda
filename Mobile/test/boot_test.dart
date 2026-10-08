import 'package:flutter_test/flutter_test.dart';

import 'package:koda_voice/main.dart';
import 'package:koda_voice/widgets/koda_orb.dart';

void main() {
  testWidgets('boots into the voice home in the disconnected state',
      (tester) async {
    await tester.pumpWidget(const KodaApp());
    // The orb animates continuously, so pump a frame rather than settling.
    await tester.pump();

    // Observable boot state: the hero prompt, the idle status caption, and
    // the orb. Nothing connects until the user acts.
    expect(find.text('What should we work on?'), findsOneWidget);
    expect(find.text('Ready when you are'), findsOneWidget);
    expect(find.byType(KodaOrb), findsOneWidget);
  });
}
