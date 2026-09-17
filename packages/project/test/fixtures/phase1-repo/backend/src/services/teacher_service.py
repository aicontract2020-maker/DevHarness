def get_teacher_id(payload):
    if payload.get("role") != "teacher":
        raise Exception("teacher required")
