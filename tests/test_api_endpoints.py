import unittest
import urllib.request
import urllib.error
import json

class TestCuratorAPIEndpoints(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"

    def test_01_auth_success(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertIn("token", res)
        self.__class__.token = res["token"]

    def test_02_auth_failure(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": "wrong-password-123"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_03_authenticated_status(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/status",
            headers={"Curator-Token": self.__class__.token}
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["authenticated"])
        self.assertGreaterEqual(res["pendingCount"], 1)
        self.assertGreaterEqual(res["masterCount"], 70)

    def test_04_unauthenticated_queue_blocked(self):
        req = urllib.request.Request(f"{self.BASE_URL}/api/curator/queue")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_05_authenticated_queue_success(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/queue",
            headers={"Curator-Token": self.__class__.token}
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertGreaterEqual(len(res["quarantinedEvents"]), 1)

    def test_06_learn_rule(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/learn-rule",
            data=json.dumps({
                "ruleType": "course_blacklist_patterns",
                "key": "",
                "value": "curator-test-course-pattern"
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.__class__.token
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertIn("curator-test-course-pattern", res["rules"]["course_blacklist_patterns"])

if __name__ == "__main__":
    unittest.main()
