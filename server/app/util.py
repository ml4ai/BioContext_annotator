"""
Common utility functions and classes
"""


# Namespace class for storing object-like data
class Namespace:
    def __repr__(self):
        import pprint
        return pprint.pformat(vars(self), indent=2)
