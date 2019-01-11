"""
Exceptions
"""


class RestartInterrupt(Exception):
    """
    Server Restart
    """

    def __init__(self):
        self.value = "RestartInterrupt"

    def __str__(self):
        return repr(self.value)


class ShutdownInterrupt(Exception):
    """
    Server Shutdown
    """

    def __init__(self):
        self.value = "ShutdownInterrupt"

    def __str__(self):
        return repr(self.value)


class CustomError(Exception):
    """
    For sending custom messages out of server processes via exceptions
    (amongst other things)
    """

    def __init__(self, message, pre='', post=''):
        self.pre = pre
        self.message = message
        self.post = post

    def __str__(self):
        return ''.join([self.pre, self.message, self.post])
